// Output-language preference only; professional art direction and sampling stay
// in their existing contracts. Callers that omit it retain their prior behavior.
export const isArtPromptLanguage = value => value === undefined || value === 'zh-CN' || value === 'en';
export function artPromptLanguageSystem(system, language, {conversationOnly = false} = {}) {
  if (language === 'en' && conversationOnly) return system + '\n\nConverse and explain your choices in Simplified Chinese. When providing a drawing execution prompt, write the prompt itself in English by default; honor an explicit request for another prompt language. Preserve requested visible lettering, proper names and reference identifiers literally. This language preference grants no tools or execution authority.';
  if (language !== 'zh-CN') return system;
  const instruction = conversationOnly
    ? 'When providing a drawing prompt for the user to edit, write its instructional prose in Simplified Chinese by default; honor an explicit request for another language. Keep requested visible lettering, proper names and reference identifiers literal. This language preference grants no application tools or execution authority.'
    : 'OUTPUT LANGUAGE FOR THIS REQUEST: Write the complete execution prompt and sourceContent in natural Simplified Chinese, so the user can edit them directly, unless the latest user explicitly requests another prompt language. This overrides English-only field descriptions and English word-count guidance above, but changes no art-direction decision. Keep comparable useful detail without padding, one complete prompt and the existing output/tool schema. Preserve <image1>, <image2> and any other program reference identifiers exactly; keep requested visible lettering and proper names literal. The current negative prompt and sampling remain unchanged. Do not produce a second bilingual prompt or request a separate translation call.';
  return system + '\n\n' + instruction;
}
export function artPromptLanguageTools(tools, language) {
  if (language !== 'zh-CN') return tools;
  return tools.map(tool => {
    const parameters = tool.function.parameters, properties = parameters.properties;
    if (!properties?.prompt) return tool;
    return {...tool, function: {...tool.function, parameters: {...parameters, properties: {...properties,
      prompt: {...properties.prompt, description: 'Complete execution prompt in Simplified Chinese, with exact <image1>/<image2> program markers when present; preserve literal lettering requested for the artwork.'},
      ...(properties.sourceContent ? {sourceContent: {...properties.sourceContent, description: 'One short factual Simplified Chinese content sentence from the complete source image; retain identity, actual expression/action, characteristic objects and original scene.'}} : {})
    }}}};
  });
}
