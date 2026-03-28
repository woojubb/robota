import { visit } from 'unist-util-visit';

export default function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang === 'mermaid') {
        parent.children[index] = {
          type: 'html',
          value: `<pre class="mermaid">${node.value}</pre>`,
        };
      }
    });
  };
}
