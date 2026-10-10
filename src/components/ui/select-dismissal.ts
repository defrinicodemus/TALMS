// Radix Select handles pointerdown immediately, while Dialog may wait for click.
// Remember the native event so a dismissed Select cannot also dismiss its parent.
// WeakSet keeps this scoped to one interaction, without timers or a sticky flag.
const selectOutsideInteractions = new WeakSet<Event>();

export function markSelectOutsideInteraction(event: Event) {
  selectOutsideInteractions.add(event);
}

export function isSelectOutsideInteraction(event: Event) {
  return selectOutsideInteractions.has(event);
}
