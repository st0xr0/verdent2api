export const messageSerializer = {
  simplePrompt(text) {
    const safeText = text || '';
    return {
      role: 'user',
      content: [{ type: 'text', text: safeText }],
      rawText: safeText,
    };
  },
};
