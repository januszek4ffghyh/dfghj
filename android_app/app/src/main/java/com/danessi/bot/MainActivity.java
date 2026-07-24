package com.danessi.bot;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.util.Rational;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.preference.PreferenceManager;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.google.android.material.floatingactionbutton.FloatingActionButton;

import java.util.concurrent.Executor;

public class MainActivity extends AppCompatActivity implements SensorEventListener {
    private WebView webView;
    private WebView stealthWebView;
    private boolean isStealthActive = false;
    private LinearLayout loadingLayout;
    private TextView loadingStatus;
    private ImageView loadingLogo;
    private SwipeRefreshLayout swipeRefreshLayout;
    private FloatingActionButton fabSettings;
    private SharedPreferences prefs;
    private Handler autoRefreshHandler = new Handler();
    private Vibrator vibrator;
    private MediaPlayer mediaPlayer;
    private CameraManager cameraManager;
    private String cameraId;
    
    // Shake Detection
    private SensorManager sensorManager;
    private float acceleration;
    private float currentAcceleration;
    private float lastAcceleration;

    private static final String DEFAULT_URL = "http://zephyr.proxy.rlwy.net:14192/dashboard/";
    private static final String CHANNEL_ID = "bot_alerts";

    // Network Receiver
    private BroadcastReceiver networkReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!isNetworkAvailable()) {
                showBotError("UTRACO_POŁĄCZENIE Z SIECIĄ");
                playSystemSound(ToneGenerator.TONE_CDMA_SOFT_ERROR_LITE);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        cameraManager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            cameraId = cameraManager.getCameraIdList()[0];
        } catch (Exception e) {
            Log.e("BotCamera", "No camera found");
        }
        
        acceleration = 10f;
        currentAcceleration = SensorManager.GRAVITY_EARTH;
        lastAcceleration = SensorManager.GRAVITY_EARTH;

        createNotificationChannel();
        applySystemSettings();
        
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        stealthWebView = findViewById(R.id.stealth_webview);
        loadingLayout = findViewById(R.id.loading_layout);
        loadingStatus = findViewById(R.id.loading_status);
        loadingLogo = findViewById(R.id.loading_logo);
        swipeRefreshLayout = findViewById(R.id.swipe_refresh);
        fabSettings = findViewById(R.id.fab_settings);

        // Biometric Security Check
        if (prefs.getBoolean("use_biometrics", false)) {
            checkBiometrics();
        } else {
            startBotApp();
        }
    }

    private void startBotApp() {
        Animation rotate = AnimationUtils.loadAnimation(this, R.anim.rotate);
        loadingLogo.startAnimation(rotate);
        playSystemSound(ToneGenerator.TONE_PROP_BEEP);
        playStartupMusic();

        swipeRefreshLayout.setColorSchemeColors(getResources().getColor(R.color.primary));
        swipeRefreshLayout.setOnRefreshListener(() -> webView.reload());

        fabSettings.setOnClickListener(v -> {
            Intent intent = new Intent(MainActivity.this, SettingsActivity.class);
            startActivity(intent);
        });

        configureWebView();
        configureStealthWebView();
        loadBot();
        startAutoRefresh();
        
        registerReceiver(networkReceiver, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
    }

    private void checkBiometrics() {
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt biometricPrompt = new BiometricPrompt(MainActivity.this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                Toast.makeText(getApplicationContext(), "Błąd autoryzacji: " + errString, Toast.LENGTH_SHORT).show();
                finish();
            }

            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                startBotApp();
            }

            @Override
            public void onAuthenticationFailed() {
                super.onAuthenticationFailed();
                Toast.makeText(getApplicationContext(), "Nie rozpoznano!", Toast.LENGTH_SHORT).show();
            }
        });

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Logowanie do Bota")
                .setSubtitle("Użyj biometrii, aby uzyskać dostęp")
                .setNegativeButtonText("Wyjdź")
                .build();

        biometricPrompt.authenticate(promptInfo);
    }

    private void applySystemSettings() {
        if (prefs.getBoolean("keep_screen_on", true)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        if (prefs.getBoolean("screenshot_protect", false)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }

        if (prefs.getBoolean("immersive_mode", true)) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }

        String orientation = prefs.getString("orientation_lock", "0");
        switch (orientation) {
            case "1": setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT); break;
            case "2": setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); break;
            default: setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED); break;
        }
    }

    private void playStartupMusic() {
        if (prefs.getBoolean("enable_startup_music", true)) {
            try {
                if (mediaPlayer != null) {
                    mediaPlayer.release();
                }
                mediaPlayer = MediaPlayer.create(this, R.raw.startup_music);
                mediaPlayer.setVolume(0.5f, 0.5f);
                mediaPlayer.start();
            } catch (Exception e) {
                Log.e("BotMusic", "Error playing startup music", e);
            }
        }
    }

    private void configureStealthWebView() {
        WebSettings settings = stealthWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        stealthWebView.setWebViewClient(new WebViewClient());
        
        loadStealthContent();

        // Combined Touch Listener for Gestures
        webView.setOnTouchListener(this::handleBotTouch);
        stealthWebView.setOnTouchListener(this::handleBotTouch);
    }

    private boolean handleBotTouch(View v, MotionEvent event) {
        int pointerCount = event.getPointerCount();
        
        // Stealth Mode (2 fingers)
        if (prefs.getBoolean("enable_stealth_mode", false) && pointerCount == 2) {
            if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) {
                toggleStealthMode();
                v.performClick();
                return true;
            }
        }

        // UFO Abduction (3 fingers pinch-like)
        if (prefs.getBoolean("enable_ufo_protocol", false) && pointerCount == 3) {
            if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) {
                startUfoAbduction();
                return true;
            }
        }
        
        return false;
    }

    private void startUfoAbduction() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, 1234);
            return;
        }

        Animation abduction = AnimationUtils.loadAnimation(this, R.anim.ufo_abduction);
        abduction.setAnimationListener(new Animation.AnimationListener() {
            @Override
            public void onAnimationStart(Animation animation) {}
            @Override
            public void onAnimationEnd(Animation animation) {
                // Start the Floating UFO Service
                Intent serviceIntent = new Intent(MainActivity.this, FloatingUfoService.class);
                startService(serviceIntent);

                moveTaskToBack(true);
                Toast.makeText(MainActivity.this, "UFO Abduction: Adios Amor!", Toast.LENGTH_LONG).show();
                playMorseSignal("ADIOS AMOR");
            }
            @Override
            public void onAnimationRepeat(Animation animation) {}
        });
        webView.startAnimation(abduction);
    }

    private void playMorseSignal(String text) {
        if (!prefs.getBoolean("enable_morse_flashlight", false) || cameraId == null) return;

        new Thread(() -> {
            String morse = translateToMorse(text);
            for (char c : morse.toCharArray()) {
                try {
                    if (c == '.') {
                        toggleFlash(true);
                        Thread.sleep(200);
                        toggleFlash(false);
                        Thread.sleep(200);
                    } else if (c == '-') {
                        toggleFlash(true);
                        Thread.sleep(600);
                        toggleFlash(false);
                        Thread.sleep(200);
                    } else if (c == ' ') {
                        Thread.sleep(400);
                    }
                } catch (Exception e) {
                    break;
                }
            }
        }).start();
    }

    private void toggleFlash(boolean on) throws CameraAccessException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            cameraManager.setTorchMode(cameraId, on);
        }
    }

    private String translateToMorse(String text) {
        // Very simplified Morse map
        String[] codes = {".-", "-...", "-.-.", "-..", ".", "..-.", "--.", "....", "..", ".---", "-.-", ".-..", "--", "-.", "---", ".--.", "--.-", ".-.", "...", "-", "..-", "...-", ".--", "-..-", "-.--", "--.."};
        StringBuilder sb = new StringBuilder();
        for (char c : text.toUpperCase().toCharArray()) {
            if (c >= 'A' && c <= 'Z') sb.append(codes[c - 'A']).append(" ");
            else if (c == ' ') sb.append("  ");
        }
        return sb.toString();
    }

    private void loadStealthContent() {
        String type = prefs.getString("stealth_mode_type", "0");
        if ("1".equals(type)) {
            stealthWebView.loadUrl("file:///android_asset/calculator.html");
        } else {
            String stealthUrl = prefs.getString("stealth_url", "https://www.wikipedia.org");
            stealthWebView.loadUrl(stealthUrl);
        }
    }

    private void toggleStealthMode() {
        isStealthActive = !isStealthActive;
        if (isStealthActive) {
            loadStealthContent();
            webView.setVisibility(View.GONE);
            fabSettings.hide();
            stealthWebView.setVisibility(View.VISIBLE);
            vibrate(50);
        } else {
            stealthWebView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            fabSettings.show();
            vibrate(50);
        }
    }

    private void configureWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        
        // Performance optimizations
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setSupportZoom(true);
        webSettings.setBuiltInZoomControls(true);
        webSettings.setDisplayZoomControls(false);
        
        // Advanced optimizations
        webSettings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webSettings.setSafeBrowsingEnabled(false);
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            if (prefs.getBoolean("force_dark", true)) {
                WebSettingsCompat.setForceDark(webSettings, WebSettingsCompat.FORCE_DARK_ON);
            } else {
                WebSettingsCompat.setForceDark(webSettings, WebSettingsCompat.FORCE_DARK_OFF);
            }
        }

        if (prefs.getBoolean("desktop_mode", false)) {
            webSettings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        } else {
            webSettings.setUserAgentString(null);
        }

        if (prefs.getBoolean("enable_js_bridge", true)) {
            webView.addJavascriptInterface(new BotJavaScriptInterface(this), "AndroidBot");
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                if (prefs.getBoolean("log_console", false)) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "[JS] " + consoleMessage.message(), Toast.LENGTH_SHORT).show());
                }
                Log.d("BotConsole", consoleMessage.message());
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loadingStatus.setText("Nawiązywanie połączenia...");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                swipeRefreshLayout.setRefreshing(false);
                if (loadingLayout.getVisibility() == View.VISIBLE) {
                    hideLoadingScreen();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                swipeRefreshLayout.setRefreshing(false);
                showBotError("BŁĄD POŁĄCZENIA - SERWER OFFLINE");
            }
        });
    }

    private void showBotError(String msg) {
        loadingStatus.setText(msg);
        loadingStatus.setTextColor(android.graphics.Color.RED);
        playSystemSound(ToneGenerator.TONE_CDMA_SOFT_ERROR_LITE);
        vibrate(300);
    }

    private void hideLoadingScreen() {
        Animation fadeOut = AnimationUtils.loadAnimation(this, android.R.anim.fade_out);
        Animation fadeIn = AnimationUtils.loadAnimation(this, R.anim.fade_in);
        loadingLayout.startAnimation(fadeOut);
        loadingLayout.setVisibility(View.GONE);
        loadingLogo.clearAnimation();
        webView.startAnimation(fadeIn);
        webView.setVisibility(View.VISIBLE);
        fabSettings.show();
    }

    private void loadBot() {
        String url = prefs.getString("server_url", DEFAULT_URL);
        webView.loadUrl(url);
    }

    private void startAutoRefresh() {
        autoRefreshHandler.removeCallbacksAndMessages(null);
        String intervalStr = prefs.getString("auto_refresh_interval", "0");
        final int intervalMins;
        try {
            intervalMins = Integer.parseInt(intervalStr);
        } catch (NumberFormatException e) {
            return;
        }
        
        if (intervalMins > 0) {
            autoRefreshHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    webView.reload();
                    autoRefreshHandler.postDelayed(this, (long) intervalMins * 60 * 1000);
                }
            }, (long) intervalMins * 60 * 1000);
        }
    }

    private void playSystemSound(int toneType) {
        if (prefs.getBoolean("enable_sound", true)) {
            try {
                ToneGenerator toneGen1 = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
                toneGen1.startTone(toneType, 200);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    private void vibrate(int duration) {
        if (vibrator != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(duration);
            }
        }
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
        return activeNetwork != null && activeNetwork.isConnectedOrConnecting();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Bot Alerts", NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (prefs.getBoolean("shake_refresh", false)) {
            float x = event.values[0];
            float y = event.values[1];
            float z = event.values[2];
            lastAcceleration = currentAcceleration;
            currentAcceleration = (float) Math.sqrt((double) (x * x + y * y + z * z));
            float delta = currentAcceleration - lastAcceleration;
            acceleration = acceleration * 0.9f + delta;
            if (acceleration > 12) {
                webView.reload();
                vibrate(100);
                Toast.makeText(this, "Odświeżanie (Wstrząs)", Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP && prefs.getBoolean("volume_control", false)) {
            webView.reload();
            vibrate(50);
            Toast.makeText(this, "Manual Refresh", Toast.LENGTH_SHORT).show();
            return true;
        }
        
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            event.startTracking();
            return true;
        }
        
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            handlePanicButton();
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    private void handlePanicButton() {
        String action = prefs.getString("panic_button_action", "0");
        vibrate(500);
        switch (action) {
            case "1": // Close
                finishAffinity();
                break;
            case "2": // Clear and close
                webView.clearCache(true);
                webView.clearHistory();
                finishAffinity();
                break;
            case "3": // Minimize
                moveTaskToBack(true);
                break;
        }
    }

    @Override
    public void onUserLeaveHint() {
        if (prefs.getBoolean("enable_pip", true)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(16, 9))
                        .build();
                enterPictureInPictureMode(params);
            }
        }
    }

    public class BotJavaScriptInterface {
        Context mContext;
        BotJavaScriptInterface(Context c) { mContext = c; }

        @JavascriptInterface
        public void sendNotification(String title, String message) {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(mContext, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_bot_logo)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify((int) System.currentTimeMillis(), builder.build());
            }
        }

        @JavascriptInterface
        public int getBatteryLevel() {
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        }

        @JavascriptInterface
        public boolean isWifi() {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkInfo info = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
            return info != null && info.isConnected();
        }

        @JavascriptInterface
        public void showToast(String toast) {
            Toast.makeText(mContext, toast, Toast.LENGTH_SHORT).show();
        }

        @JavascriptInterface
        public void playAlert() {
            playSystemSound(ToneGenerator.TONE_PROP_BEEP);
            vibrate(100);
        }

        @JavascriptInterface
        public void vibrate(int duration) {
            MainActivity.this.vibrate(duration);
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> webView.reload());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applySystemSettings();
        sensorManager.registerListener(this, sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), SensorManager.SENSOR_DELAY_UI);
    }

    @Override
    protected void onPause() {
        super.onPause();
        sensorManager.unregisterListener(this);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (mediaPlayer != null) {
            mediaPlayer.release();
            mediaPlayer = null;
        }
        try {
            unregisterReceiver(networkReceiver);
        } catch (Exception e) {}
    }

    @Override
    public void onBackPressed() {
        if (isStealthActive) {
            if (stealthWebView.canGoBack()) {
                stealthWebView.goBack();
            } else {
                vibrate(50); // Inform user they are in stealth
            }
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
