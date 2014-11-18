/**
 * This file defines a number of standard macros.
 *
 * This file is originally from Discworld.
 */

function tryExtraMacro(decaf, keycode) {
  // f-key macros
  if (112 <= keycode && keycode <= 121 && fkeys_enabled()) {
    var cmd = "f" + (keycode-111);
    decaf.sendInput(cmd);
    return 1;
  }

  // numpad walking
  if (numpad_enabled()) {
    switch (keycode) {
      case 96:  decaf.sendInput("kp0");     return 1;
      case 97:  decaf.sendInput("kp1");     return 1;
      case 98:  decaf.sendInput("south");   return 1;
      case 99:  decaf.sendInput("kp3");     return 1;
      case 100: decaf.sendInput("west");    return 1;
      case 101: decaf.sendInput("kp5");     return 1;
      case 102: decaf.sendInput("east");    return 1;
      case 103: decaf.sendInput("kp7");     return 1;
      case 104: decaf.sendInput("north");   return 1;
      case 105: decaf.sendInput("kp9");     return 1;
      case 106: decaf.sendInput("kpstar");  return 1;
      case 107: decaf.sendInput("kpplus");  return 1;
      case 109: decaf.sendInput("kpminus"); return 1;
      case 110: decaf.sendInput("kpdot");   return 1;
      case 111: decaf.sendInput("kpslash"); return 1;
    }
  }

  // don't allow the tab key to do anything!
  if (keycode == 9) return 1;

  // anything else (not handled)
  return 0;
}

