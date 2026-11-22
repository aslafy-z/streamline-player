package com.datahearth.streamline_player

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    fitAboveKeyboard(findViewById(android.R.id.content))
  }

  // Edge to edge, the system no longer resizes the window for the keyboard (adjustResize is a
  // no-op), so it covers the bottom of the page and nothing past it can be scrolled into view.
  // The content stops at the keyboard's top instead, and the webview sees no keyboard and, while
  // it is up, no navigation bar under it either: the page's bottom inset would be air.
  private fun fitAboveKeyboard(root: View) {
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.updatePadding(bottom = ime)
      if (ime == 0) return@setOnApplyWindowInsetsListener insets
      val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(nav.left, nav.top, nav.right, 0))
        .build()
    }
  }
}
