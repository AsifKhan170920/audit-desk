package com.fairtax.portal;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FTSystemPlugin.class);
        registerPlugin(FTSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
