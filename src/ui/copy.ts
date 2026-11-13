/**
 * Every string on the start screen. Spec 7.4 strings are verbatim; the rest follow its voice
 * (British English, sentence case, no exclamation marks, short plain words).
 */
export const COPY = {
  title: 'Let go of a balloon',
  explainer: "Pick a place, let go, and follow it on today's real winds for three days",
  searchPlaceholder: 'Search for a town',
  notice: 'A simulation using forecast winds, not a real balloon. Real party balloons climb higher and pop; this one floats at about 1.5 km so you can see the ground.',
  letGo: 'Let go',
  useMyLocation: 'Use my location',
  findingYou: 'Finding you',
  searching: 'Searching',
  noPlaces: 'No places found. Try a nearby town.',
  locationOff: 'Location is off. Search for your town instead.',
  // not fixed by 7.4: written to match its voice
  searchFailed: "We can't search right now. Try again in a moment.",
  from: 'From',
  yourLocation: 'Your location',
  cancel: 'Cancel',
  credits: 'Credits',
  close: 'Close',
  featured: 'Featured cities',
  yourBalloons: 'Your balloons',
  landed: 'landed',
  aloft: (hours: number) => `${hours} h aloft`,
  mapCredit: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap © Mapterhorn',
  stillSignal: 'A Still Signal build',
} as const;
