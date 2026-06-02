#[cfg(feature = "gamepad")]
use gilrs::{Gilrs, Event, EventType, Button, Axis};
#[cfg(feature = "gamepad")]
use serde::Serialize;
#[cfg(feature = "gamepad")]
use tauri::Emitter;
#[cfg(feature = "gamepad")]
use crate::constants;

#[cfg(feature = "gamepad")]
#[derive(Clone, Serialize)]
struct GamepadButtonPayload {
    code: String,
    state: bool, // true = pressed, false = released
}

#[cfg(feature = "gamepad")]
#[derive(Clone, Serialize)]
struct GamepadAxisPayload {
    axis: String,
    value: f32,
}

#[cfg(feature = "gamepad")]
pub fn start_gamepad_loop(app_handle: tauri::AppHandle) {
    let mut gilrs = match Gilrs::new() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Failed to initialize Gilrs: {:?}", e);
            return;
        }
    };

    println!("Gamepad support initialized with Gilrs.");

    // Track trigger presses for threshold detection
    let mut lt_pressed = false;
    let mut rt_pressed = false;

    loop {
        // Read all events
        while let Some(Event { id, event, .. }) = gilrs.next_event() {
            match event {
                EventType::Connected => {
                    let name = gilrs.gamepad(id).name().to_string();
                    println!("Gamepad {} ({}) connected", id, name);
                    let _ = app_handle.emit("gamepad-connection", true);
                    let _ = app_handle.emit("gamepad-device", name);
                }
                EventType::Disconnected => {
                    println!("Gamepad {} disconnected", id);
                    let _ = app_handle.emit("gamepad-connection", false);
                }
                EventType::ButtonPressed(btn, _) => {
                    if let Some(code) = map_button(btn) {
                        let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                            code: code.to_string(),
                            state: true,
                        });
                    }
                }
                EventType::ButtonReleased(btn, _) => {
                    if let Some(code) = map_button(btn) {
                        let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                            code: code.to_string(),
                            state: false,
                        });
                    }
                }
                EventType::AxisChanged(axis, val, _) => {
                    let code = match axis {
                        Axis::LeftStickX => Some("ABS_X"),
                        Axis::LeftStickY => Some("ABS_Y"),
                        Axis::RightStickX => Some("ABS_RX"),
                        Axis::RightStickY => Some("ABS_RY"),
                        // Threshold detection for triggers
                        Axis::LeftZ => {
                            if val > constants::GAMEPAD_TRIGGER_PRESS_THRESHOLD && !lt_pressed {
                                lt_pressed = true;
                                let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                                    code: "TRIGGER_LEFT".to_string(),
                                    state: true,
                                });
                            } else if val < constants::GAMEPAD_TRIGGER_RELEASE_THRESHOLD && lt_pressed {
                                lt_pressed = false;
                                let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                                    code: "TRIGGER_LEFT".to_string(),
                                    state: false,
                                });
                            }
                            None
                        }
                        Axis::RightZ => {
                            if val > constants::GAMEPAD_TRIGGER_PRESS_THRESHOLD && !rt_pressed {
                                rt_pressed = true;
                                let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                                    code: "TRIGGER_RIGHT".to_string(),
                                    state: true,
                                });
                            } else if val < constants::GAMEPAD_TRIGGER_RELEASE_THRESHOLD && rt_pressed {
                                rt_pressed = false;
                                let _ = app_handle.emit("gamepad-button", GamepadButtonPayload {
                                    code: "TRIGGER_RIGHT".to_string(),
                                    state: false,
                                });
                            }
                            None
                        }
                        _ => None,
                    };

                    if let Some(axis_code) = code {
                        let _ = app_handle.emit("gamepad-axis", GamepadAxisPayload {
                            axis: axis_code.to_string(),
                            value: val,
                        });
                    }
                }
                _ => {}
            }
        }

        // Sleep briefly to avoid high CPU usage
        std::thread::sleep(std::time::Duration::from_millis(constants::GAMEPAD_POLL_INTERVAL_MS));
    }
}

#[cfg(feature = "gamepad")]
fn map_button(btn: Button) -> Option<&'static str> {
    match btn {
        Button::South => Some("BTN_A"), // BTN_SOUTH
        Button::East => Some("BTN_B"),  // BTN_EAST
        Button::West => Some("BTN_X"),  // BTN_WEST
        Button::North => Some("BTN_Y"), // BTN_NORTH
        Button::LeftTrigger => Some("BTN_TL"),  // shoulder/bumper
        Button::RightTrigger => Some("BTN_TR"), // shoulder/bumper
        Button::LeftTrigger2 => Some("BTN_TL2"),
        Button::RightTrigger2 => Some("BTN_TR2"),
        Button::LeftThumb => Some("BTN_THUMBL"),
        Button::RightThumb => Some("BTN_THUMBR"),
        Button::Select => Some("BTN_SELECT"),
        Button::Start => Some("BTN_START"),
        Button::DPadUp => Some("DPAD_UP"),
        Button::DPadDown => Some("DPAD_DOWN"),
        Button::DPadLeft => Some("DPAD_LEFT"),
        Button::DPadRight => Some("DPAD_RIGHT"),
        _ => None,
    }
}

// Fallback when gamepad feature is disabled
#[cfg(not(feature = "gamepad"))]
pub fn start_gamepad_loop(_app_handle: tauri::AppHandle) {}
