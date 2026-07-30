// Release builds attach to the Windows GUI subsystem so launching the app does
// not spawn a console window. Debug builds keep the console for tracing output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tethra_lib::run();
}
