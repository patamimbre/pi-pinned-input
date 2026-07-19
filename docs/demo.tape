# pi-pinned-input demo — regenerate with:  vhs docs/demo.tape
# Records the pinned prompt editor staying anchored while the bounded
# history viewport scrolls above it.

Output docs/demo.gif

Require pi

Set Shell "zsh"
Set FontSize 14
Set Width 1100
Set Height 720
Set Padding 16
Set Framerate 24
Set TypingSpeed 40ms

# Launch Pi in this project; the extension auto-loads (ephemeral session).
Type "pi --no-session"
Enter
Sleep 5s

# One real turn to fill the history viewport with scrollable content.
Type "Give me a numbered list of 24 short terminal keyboard shortcuts, one per line, no intro or outro."
Enter
Sleep 25s

# The prompt editor stays pinned at the bottom. Scroll the bounded
# history viewport up with the keyboard — the input never moves.
PageUp
Sleep 1500ms
PageUp
Sleep 1500ms
PageUp
Sleep 2s

# Scroll back down to the bottom (re-anchors the follow-bottom viewport).
PageDown
Sleep 700ms
PageDown
Sleep 700ms
PageDown
Sleep 700ms
PageDown
Sleep 2s

# Start typing a new draft — the editor grows with it, still anchored.
Type "Thanks — now do the same for tmux"
Sleep 2500ms

# Quit.
Ctrl+C
Sleep 600ms
Ctrl+C
Sleep 1200ms
