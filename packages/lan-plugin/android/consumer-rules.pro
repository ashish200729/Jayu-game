# Applied to the host app when it minifies: keep the plugin class and its
# @PluginMethod methods, which Capacitor looks up by reflection.
-keep @com.getcapacitor.annotation.CapacitorPlugin class com.jayu.lan.JayuLanPlugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep class com.jayu.lan.JayuLanPlugin { *; }
