using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Media.SpeechRecognition;

namespace FairTaxSpeech
{
    internal static class Program
    {
        private static readonly object Gate = new object();

        private static void Emit(string type, string key = null, string value = null)
        {
            var sb = new StringBuilder("{\"type\":\"").Append(type).Append('"');
            if (key != null) sb.Append(",\"").Append(key).Append("\":\"").Append(Escape(value ?? "")).Append('"');
            sb.Append('}');
            lock (Gate)
            {
                Console.Out.WriteLine(sb.ToString());
                Console.Out.Flush();
            }
        }

        // ASCII-only JSON so the text survives any console code page (Arabic, Urdu …)
        private static string Escape(string s)
        {
            var sb = new StringBuilder(s.Length + 8);
            foreach (var ch in s)
            {
                if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
                else if (ch < 0x20 || ch > 0x7e) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        private static string Describe(Exception ex)
        {
            uint hr = unchecked((uint)ex.HResult);
            if (hr == 0x80045509) return "privacy|Turn on online speech recognition: Windows Settings > Privacy & security > Speech > Online speech recognition = On.";
            if (hr == 0x80070005) return "microphone|Allow the microphone: Windows Settings > Privacy & security > Microphone > turn on \"Let desktop apps access your microphone\".";
            if (hr == 0x800455A0 || hr == 0x8004503A) return "language|This speech language is not installed in Windows. Choose English in the assistant settings, or add the language in Windows Settings > Time & language > Speech.";
            if (hr == 0x80045500) return "nomic|No microphone found. Connect a microphone and choose it in Windows Settings > System > Sound > Input.";
            return "other|" + ex.Message + " (0x" + hr.ToString("X8") + ")";
        }

        private static int Main(string[] args)
        {
            try
            {
                return Run(args).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Emit("error", "message", Describe(ex));
                return 1;
            }
        }

        private static Language PickLanguage(string tag, out string note)
        {
            note = null;
            try
            {
                var supported = SpeechRecognizer.SupportedTopicLanguages;
                if (string.IsNullOrWhiteSpace(tag)) return null;
                var exact = supported.FirstOrDefault(l => string.Equals(l.LanguageTag, tag, StringComparison.OrdinalIgnoreCase));
                if (exact != null) return exact;
                var prefix = tag.Split('-')[0];
                var system = SpeechRecognizer.SystemSpeechLanguage;
                if (system != null && system.LanguageTag.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return system;
                var similar = supported.FirstOrDefault(l => l.LanguageTag.StartsWith(prefix + "-", StringComparison.OrdinalIgnoreCase));
                if (similar != null) return similar;
                note = "The chosen voice language is not installed in Windows - using " + (system != null ? system.DisplayName : "the Windows speech language") + ".";
            }
            catch (Exception)
            {
                // fall back to the Windows speech language
            }
            return null;
        }

        private static async Task<int> Run(string[] args)
        {
            string note;
            var language = PickLanguage(args.Length > 0 ? args[0] : "", out note);
            using (var recognizer = language != null ? new SpeechRecognizer(language) : new SpeechRecognizer())
            {
                recognizer.Constraints.Add(new SpeechRecognitionTopicConstraint(SpeechRecognitionScenario.Dictation, "dictation"));
                var compiled = await recognizer.CompileConstraintsAsync();
                if (compiled.Status != SpeechRecognitionResultStatus.Success)
                {
                    Emit("error", "message", compiled.Status == SpeechRecognitionResultStatus.NetworkFailure
                        ? "network|Windows speech needs the internet - check the connection."
                        : "compile|Windows speech could not start (" + compiled.Status + "). Check Windows Settings > Privacy & security > Speech.");
                    return 2;
                }
                try { recognizer.ContinuousRecognitionSession.AutoStopSilenceTimeout = TimeSpan.FromMinutes(10); } catch (Exception) { }
                try { recognizer.Timeouts.EndSilenceTimeout = TimeSpan.FromMilliseconds(800); } catch (Exception) { }

                var done = new TaskCompletionSource<bool>();
                recognizer.HypothesisGenerated += (s, e) => Emit("partial", "text", e.Hypothesis.Text);
                recognizer.ContinuousRecognitionSession.ResultGenerated += (s, e) =>
                {
                    var r = e.Result;
                    if (r.Status == SpeechRecognitionResultStatus.Success && r.Confidence != SpeechRecognitionConfidence.Rejected && !string.IsNullOrWhiteSpace(r.Text))
                        Emit("final", "text", r.Text);
                    else
                        Emit("partial", "text", "");
                };
                recognizer.ContinuousRecognitionSession.Completed += (s, e) =>
                {
                    if (e.Status == SpeechRecognitionResultStatus.NetworkFailure) Emit("error", "message", "network|Windows speech lost the internet connection.");
                    else if (e.Status == SpeechRecognitionResultStatus.MicrophoneUnavailable) Emit("error", "message", "nomic|The microphone is not available (check Windows sound settings, or close other apps using it).");
                    else if (e.Status != SpeechRecognitionResultStatus.Success && e.Status != SpeechRecognitionResultStatus.UserCanceled && e.Status != SpeechRecognitionResultStatus.TimeoutExceeded)
                        Emit("error", "message", "session|Windows speech stopped (" + e.Status + ").");
                    done.TrySetResult(true);
                };

                await recognizer.ContinuousRecognitionSession.StartAsync();
                Emit("started", "lang", recognizer.CurrentLanguage.LanguageTag);
                if (note != null) Emit("notice", "text", note);

                var reader = Task.Run(() =>
                {
                    string line;
                    while ((line = Console.In.ReadLine()) != null)
                    {
                        line = line.Trim();
                        if (line == "stop" || line == "abort") return line;
                    }
                    return "abort";
                });
                var first = await Task.WhenAny(reader, done.Task);
                if (first == reader)
                {
                    try
                    {
                        if (reader.Result == "stop") await recognizer.ContinuousRecognitionSession.StopAsync();
                        else await recognizer.ContinuousRecognitionSession.CancelAsync();
                    }
                    catch (Exception) { }
                    await Task.WhenAny(done.Task, Task.Delay(3000));
                }
                Emit("end");
                return 0;
            }
        }
    }
}
