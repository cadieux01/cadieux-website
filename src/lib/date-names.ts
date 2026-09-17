// Fixed English day/month names.
//
// These exist because `Intl` month:"short" is NOT stable across runtimes.
// en-IN renders September as "Sept" on current Node and Chrome and "Sep" on
// older ones, so the same date reads differently depending on where it was
// rendered — the admin board says "Sept", the share message says "Sep", and
// the rider reading both assumes one of them is a typo.
//
// Every place in the app that needs a short month name reads these arrays.
// There were three independent copies before this file existed; the fix for
// the next "Sept" bug should be one edit, not a grep.

export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const WEEKDAY_SHORT = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
] as const;
