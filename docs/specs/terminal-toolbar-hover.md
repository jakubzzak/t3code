# Terminal toolbar on hover

## Problem and outcome

The floating split, new-terminal, and close-terminal toolbar covers terminal output even when the pointer is elsewhere. Keep output unobscured at rest and reveal the controls when the user hovers the terminal panel.

## Scope

Apply to the floating toolbar in the bottom terminal drawer and right terminal panel, shared by web and desktop. Preserve the separate terminal sidebar controls, existing actions, permissions, shortcuts, and terminal behavior. No provider, protocol, native-mobile, or server changes are required.

## Required behavior

- On devices with hover, hide the floating toolbar when the pointer is outside its terminal panel. Hidden controls must not intercept pointer input over terminal output.
- Hovering anywhere inside the terminal panel reveals the toolbar. Moving onto its buttons keeps it visible and usable. Leaving the panel hides it again.
- Terminal input focus alone does not keep the toolbar visible after the pointer leaves.
- Preserve the existing split, new-terminal, and close-terminal actions and their availability rules.

## Acceptance criteria

1. Open a terminal from the chat controls or its existing shortcut. With the pointer outside the panel, the floating toolbar is hidden and the text beneath its usual position is readable. Hover the terminal body and then each toolbar control: the toolbar appears and remains usable. Move outside: it disappears.
2. Type in the terminal, then move the pointer outside while retaining terminal input focus. The toolbar disappears and terminal input continues working.
3. Repeat the hover/leave cycle in both bottom-drawer and right-panel placement, including split terminals. Existing sidebar controls remain usable when present.
4. Execute the existing split, new-terminal, and close-terminal flows after revealing their controls. Keep close confirmation and disabled-action behavior unchanged.

## Compatibility assumptions

These preserve access and were stated in the implementation response; they are not additional user-requested product features:

- Keyboard navigation to a toolbar button reveals the toolbar while that button has visible keyboard focus; moving focus away hides it unless the panel is hovered.
- Devices without hover keep the controls visible so touch users can reach them. Narrow layouts on hover-capable devices still follow hover behavior.

## Constraints and decisions

Use the existing shared terminal UI. Visibility must not require new network requests, timers, or a continuously repainting animation. Local, remote, and tunnel clients retain the same actions and permission boundaries.
