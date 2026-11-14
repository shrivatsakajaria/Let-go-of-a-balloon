/**
 * Every string on the start screen. Spec 7.4 strings are verbatim; the rest follow its voice
 * (British English, sentence case, no exclamation marks, short plain words). Apostrophes are typographic
 * (U+2019): "verbatim" means the wording, not the bytes (ruling R54).
 */
export const COPY = {
  title: 'Let go of a balloon',
  explainer: 'Pick a place, let go, and follow it on today’s real winds for three days',
  searchPlaceholder: 'Search for a town',
  notice: 'A simulation using forecast winds, not a real balloon. Real party balloons climb higher and pop; this one floats at about 1.5 km so you can see the ground.',
  letGo: 'Let go',
  useMyLocation: 'Use my location',
  findingYou: 'Finding you',
  searching: 'Searching',
  noPlaces: 'No places found. Try a nearby town.',
  locationOff: 'Location is off. Search for your town instead.',
  windsUnavailable: 'We can’t get today’s winds right now. Try again in a few minutes.',
  tryAgain: 'Try again',
  brokenLink: 'This balloon link is broken.',
  letGoNewOne: 'Let go of a new one',
  noWebGL: 'Your phone can’t show the 3D world, so here is the route on a map.',
  wholeTrip: 'Show me the whole trip',
  backToLive: 'Back to live',
  replayLabel: 'Forecast route, 72 hours in 20 seconds',
  // reduced motion: the route is drawn in place, not played in 20 seconds
  replayLabelStill: 'Forecast route',
  letGoAnother: 'Let go of another',
  letGoYourOwn: 'Let go of your own',
  // not fixed by 7.4: written to match its voice
  searchFailed: 'We can’t search right now. Try again in a moment.',
  locationTimeout: 'We couldn’t find you. Try again, or search for your town.',
  // the world (3D or the 2D map) could not be fetched; a browser that cannot draw 3D gets the map
  didNotLoad: 'The balloon didn’t load. Check your connection and try again.',
  pause: 'Pause',
  resume: 'Resume',
  view: 'View',
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
  // the landing card (7.4: Share card, Save image, Copy link then "Link copied"; the in-app lines from the brief)
  shareCard: 'Share card',
  saveImage: 'Save image',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: "Couldn't copy the link. Select it below to copy it.",
  linkLabel: 'Link to this balloon',
  pressAndHold: 'Press and hold to save',
  openInBrowser: 'Open in your browser',
  /** The landed HUD's way back to the card. */
  showCard: 'Show the card',
} as const;
