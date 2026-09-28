// Violates: no-restricted-syntax (dangerouslySetInnerHTML)
export const KnowledgeAnswer = (props: { html: string }) => (
  <div dangerouslySetInnerHTML={{ __html: props.html }} />
);
