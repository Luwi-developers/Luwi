package com.example.hello;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/**
 * The template's one screen.
 *
 * Keep it small: the point of this template is that a whole project builds on the phone in a few
 * seconds, so anything with a dependency has no business here.
 */
public class MainActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        TextView view = findViewById(R.id.hello);
        view.setText(getString(R.string.hello_body));
    }
}
