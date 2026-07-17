# Pinned Input

This context defines the visible regions and navigation concepts of Pi's bounded terminal conversation.

## Language

**History viewport**:
The bounded region that displays conversation output and is the sole destination of mouse-wheel scrolling.
_Avoid_: Content, chat area, output pane

**Prompt editor**:
The growing region where the current prompt draft is composed. It grows with the draft until the lower pane reaches its height limit.
_Avoid_: Input, input box, textarea

**Lower pane**:
The anchored region containing the prompt editor, status, widgets, and footer. Its total height is limited to 60% of the terminal by default (configurable between 40% and 90% via `lowerPaneMaxPercent`).
_Avoid_: Sticky pane, footer area

**Prompt history**:
The ordered set of previously submitted prompts reached with vertical arrow navigation only after the cursor reaches the absolute start or end of the current draft.
_Avoid_: Chat history, conversation history

**New-output marker**:
The "↓ new output" row shown on the bottom row of the history viewport while it is scrolled up and new output arrives below; it disappears when the viewport follows the bottom again.
_Avoid_: Unread indicator, scroll badge
