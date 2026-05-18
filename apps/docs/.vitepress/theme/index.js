import DefaultTheme from 'vitepress/theme';
import './style.css';
import { onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vitepress';

function processMermaid() {
  if (typeof window === 'undefined') return;
  const mermaid = window['mermaid'];
  if (!mermaid) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    themeVariables: {
      primaryColor: '#7c6bf7',
      primaryTextColor: '#e8e4ff',
      primaryBorderColor: '#a78bfa',
      lineColor: '#7c6bf7',
      fontSize: '14px',
    },
    securityLevel: 'loose',
  });

  document
    .querySelectorAll('div[class*="language-mermaid"]:not([data-mermaid-done])')
    .forEach((wrapper) => {
      wrapper.setAttribute('data-mermaid-done', '1');
      const code = wrapper.querySelector('code');
      if (!code) return;
      const text = code.textContent || '';
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = text;
      if (wrapper.parentNode) {
        wrapper.parentNode.replaceChild(div, wrapper);
      }
    });

  mermaid.run({ querySelector: '.mermaid:not([data-processed])' });
}

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    onMounted(() => nextTick(processMermaid));
    watch(
      () => route.path,
      () => nextTick(processMermaid),
    );
  },
};
