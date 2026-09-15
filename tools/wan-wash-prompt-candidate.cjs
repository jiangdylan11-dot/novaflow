'use strict';

// Diagnostic prompt policy for the existing Wan KSampler, not a UI default.
function buildMediumFirstPrompt(profile) {
  const medium = String(profile?.medium || '').trim();
  const style = String(profile?.style || '').trim();
  const content = String(profile?.content || '').trim();
  if (!medium || !style || !content) throw Error('A complete observed medium, style and content profile is required');
  const anchor = /^(?:(?:2d|two-dimensional)\s+)?(?:anime|manga|cartoon)(?: (?:drawing|illustration|art))?$/i.test(medium)
    ? 'A hand-drawn 2D animation frame, anime illustration. Delicate drawn contours, stylized anime facial proportions, expressive drawn eyes, cel-painted skin and clothes with soft painted shading. The environment is a painted animation background.'
    : `A ${medium}. ${style}`;
  return `${anchor}\n\n${content}\n\n${style}`;
}

module.exports = { buildMediumFirstPrompt };
