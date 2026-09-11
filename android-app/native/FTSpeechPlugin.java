package com.fairtax.portal;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/** Voice for the AI assistant: live speech-to-text (with sound level for the waves) and text-to-speech. */
@CapacitorPlugin(
    name = "FTSpeech",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class FTSpeechPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingText = null;
    private String pendingLang = null;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        ret.put("permission", getPermissionState("microphone").toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("Microphone permission denied", "denied");
        }
    }

    private void begin(final PluginCall call) {
        final String lang = call.getString("lang", "en-GB");
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                        call.reject("Speech recognition is not available on this phone. Install or enable the Google app.", "unavailable");
                        return;
                    }
                    destroyRecognizer();
                    recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                    recognizer.setRecognitionListener(new Listener());
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                    intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
                    intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
                    recognizer.startListening(intent);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Could not start the microphone: " + e.getMessage(), "start");
                }
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(new Runnable() {
            @Override
            public void run() {
                if (recognizer != null) {
                    try { recognizer.stopListening(); } catch (Exception ignored) {}
                }
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void abort(PluginCall call) {
        main.post(new Runnable() {
            @Override
            public void run() { destroyRecognizer(); }
        });
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        final String lang = call.getString("lang", "en-GB");
        main.post(new Runnable() {
            @Override
            public void run() {
                if (tts == null) {
                    pendingText = text;
                    pendingLang = lang;
                    tts = new TextToSpeech(getContext(), new TextToSpeech.OnInitListener() {
                        @Override
                        public void onInit(int status) {
                            ttsReady = status == TextToSpeech.SUCCESS;
                            if (ttsReady && pendingText != null) {
                                say(pendingText, pendingLang);
                            } else if (!ttsReady) {
                                notifyListeners("ttsDone", new JSObject());
                            }
                            pendingText = null;
                        }
                    });
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) { notifyListeners("ttsDone", new JSObject()); }

                        @Override
                        @Deprecated
                        public void onError(String utteranceId) { notifyListeners("ttsDone", new JSObject()); }
                    });
                } else if (ttsReady) {
                    say(text, lang);
                } else {
                    pendingText = text;
                    pendingLang = lang;
                }
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(new Runnable() {
            @Override
            public void run() {
                pendingText = null;
                if (tts != null) {
                    try { tts.stop(); } catch (Exception ignored) {}
                }
            }
        });
        call.resolve();
    }

    private void say(String text, String lang) {
        try {
            Locale locale = Locale.forLanguageTag(lang);
            int r = tts.setLanguage(locale);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.UK);
        } catch (Exception ignored) {}
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), "ft" + System.currentTimeMillis());
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private void emitText(String event, Bundle bundle) {
        if (bundle == null) return;
        ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String text = list != null && !list.isEmpty() && list.get(0) != null ? list.get(0) : "";
        JSObject o = new JSObject();
        o.put("text", text);
        notifyListeners(event, o);
    }

    private static String errorText(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Network timeout";
            case SpeechRecognizer.ERROR_NETWORK: return "Network error";
            case SpeechRecognizer.ERROR_AUDIO: return "Microphone error";
            case SpeechRecognizer.ERROR_SERVER: return "Speech service error";
            case SpeechRecognizer.ERROR_CLIENT: return "Client error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech";
            case SpeechRecognizer.ERROR_NO_MATCH: return "Nothing recognised";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Speech service busy";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission missing";
            default: return "Speech error " + code;
        }
    }

    private class Listener implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {
            JSObject o = new JSObject();
            o.put("rms", (double) rmsdB);
            notifyListeners("level", o);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onError(int error) {
            JSObject o = new JSObject();
            o.put("code", error);
            o.put("message", errorText(error));
            notifyListeners("error", o);
            notifyListeners("end", new JSObject());
        }

        @Override
        public void onResults(Bundle results) {
            emitText("final", results);
            notifyListeners("end", new JSObject());
        }

        @Override
        public void onPartialResults(Bundle partialResults) { emitText("partial", partialResults); }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        if (tts != null) {
            try { tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
    }
}
