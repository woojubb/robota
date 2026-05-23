export function remarkMermaid() {
  return (tree: any) => {
    convertMermaidBlocks(tree);
  };
}

function convertMermaidBlocks(node: any): void {
  if (!Array.isArray(node.children)) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'code' && child.lang === 'mermaid') {
      node.children[i] = {
        type: 'mdxJsxFlowElement',
        name: 'MermaidDiagram',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'chart',
            value: child.value,
          },
        ],
        children: [],
      };
    } else {
      convertMermaidBlocks(child);
    }
  }
}
