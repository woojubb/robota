<template>
  <div class="cost-calculator">
    <div class="calc-inputs">
      <div class="input-group">
        <label>Daily coding hours</label>
        <div class="slider-row">
          <input v-model.number="hoursPerDay" type="range" min="1" max="12" step="0.5" />
          <span class="value-badge">{{ hoursPerDay }}h</span>
        </div>
      </div>

      <div class="input-group">
        <label>Primary task type</label>
        <div class="radio-group">
          <label v-for="t in taskTypes" :key="t.id" class="radio-label">
            <input v-model="taskType" type="radio" :value="t.id" />
            {{ t.label }}
          </label>
        </div>
      </div>

      <div class="input-group">
        <label>Experience level</label>
        <div class="radio-group">
          <label v-for="l in levels" :key="l.id" class="radio-label">
            <input v-model="level" type="radio" :value="l.id" />
            {{ l.label }}
          </label>
        </div>
      </div>
    </div>

    <div class="calc-results">
      <div class="tokens-estimate">
        <span class="estimate-label">Estimated monthly token usage</span>
        <span class="estimate-value">~{{ formatM(monthlyTokens) }} tokens</span>
      </div>

      <div class="comparison-grid">
        <div class="comparison-card competitor">
          <div class="card-header">Claude Code Pro</div>
          <div class="card-price">${{ claudeCodeCost }}</div>
          <div class="card-note">Flat subscription / mo</div>
        </div>

        <div v-for="p in providers" :key="p.id" class="comparison-card robota">
          <div class="card-header">robota + {{ p.name }}</div>
          <div class="card-price">${{ formatCost(p.cost) }}</div>
          <div class="card-note">Direct API / mo</div>
          <div v-if="p.savings > 0" class="card-savings">Save ${{ formatCost(p.savings) }}/mo</div>
          <div v-else-if="p.savings < 0" class="card-more">+${{ formatCost(-p.savings) }}/mo</div>
        </div>
      </div>

      <p class="disclaimer">
        Estimates based on typical input/output token ratios for each task type. Actual costs vary
        with your usage patterns. Token prices current as of May 2026.
      </p>

      <div class="share-row">
        <button class="share-btn" @click="copyShareText">
          {{ copied ? '✓ Copied!' : 'Copy result to share' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const hoursPerDay = ref(4);
const taskType = ref('mixed');
const level = ref('mid');
const copied = ref(false);

const taskTypes = [
  { id: 'code-review', label: 'Code review' },
  { id: 'generation', label: 'Code generation' },
  { id: 'debugging', label: 'Debugging' },
  { id: 'mixed', label: 'Mixed' },
];

const levels = [
  { id: 'light', label: 'Light use' },
  { id: 'mid', label: 'Regular use' },
  { id: 'heavy', label: 'Heavy use' },
];

// tokens-per-hour by task type (rough estimates from real usage data)
const tokensPerHour = {
  'code-review': { input: 15000, output: 3000 },
  generation: { input: 10000, output: 8000 },
  debugging: { input: 20000, output: 4000 },
  mixed: { input: 14000, output: 5000 },
};

// multiplier by experience level
const levelMultiplier = { light: 0.6, mid: 1.0, heavy: 1.6 };

const monthlyTokens = computed(() => {
  const tph = tokensPerHour[taskType.value];
  const mult = levelMultiplier[level.value];
  const workDays = 22;
  return Math.round(
    ((tph.input + tph.output) * hoursPerDay.value * workDays * mult) / 1000,
  ) * 1000;
});

const monthlyInput = computed(() => {
  const tph = tokensPerHour[taskType.value];
  const mult = levelMultiplier[level.value];
  const workDays = 22;
  return Math.round(tph.input * hoursPerDay.value * workDays * mult);
});

const monthlyOutput = computed(() => {
  const tph = tokensPerHour[taskType.value];
  const mult = levelMultiplier[level.value];
  const workDays = 22;
  return Math.round(tph.output * hoursPerDay.value * workDays * mult);
});

// USD per 1M tokens (input, output)
const modelPrices = [
  { id: 'sonnet', name: 'Claude Sonnet', input: 3, output: 15 },
  { id: 'haiku', name: 'Claude Haiku', input: 0.8, output: 4 },
  { id: 'gpt4o', name: 'GPT-4o', input: 2.5, output: 10 },
  { id: 'gpt4omini', name: 'GPT-4o mini', input: 0.15, output: 0.6 },
  { id: 'deepseek', name: 'DeepSeek Chat', input: 0.14, output: 0.28 },
  { id: 'gemini2flash', name: 'Gemini 2.0 Flash', input: 0.1, output: 0.4 },
];

const claudeCodeCost = 20;

const providers = computed(() =>
  modelPrices.map((m) => {
    const cost =
      (monthlyInput.value / 1_000_000) * m.input +
      (monthlyOutput.value / 1_000_000) * m.output;
    return {
      id: m.id,
      name: m.name,
      cost,
      savings: claudeCodeCost - cost,
    };
  }),
);

function formatM(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function formatCost(n) {
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(2);
  return n.toFixed(2);
}

function copyShareText() {
  const best = providers.value.reduce((a, b) => (a.savings > b.savings ? a : b));
  const text = `Using robota + ${best.name} instead of Claude Code Pro, I save $${formatCost(best.savings)}/mo at my current usage. Calculate yours: https://robota.io/tools/cost-calculator`;
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  });
}
</script>

<style scoped>
.cost-calculator {
  font-family: var(--vp-font-family-base);
  max-width: 720px;
  margin: 1.5rem 0;
}

.calc-inputs {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.input-group label:first-child {
  display: block;
  font-weight: 600;
  font-size: 0.875rem;
  margin-bottom: 0.4rem;
  color: var(--vp-c-text-1);
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.slider-row input[type='range'] {
  flex: 1;
  accent-color: var(--vp-c-brand-1);
}

.value-badge {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-radius: 4px;
  padding: 0.1rem 0.5rem;
  font-size: 0.875rem;
  font-weight: 700;
  min-width: 3rem;
  text-align: center;
}

.radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.875rem;
  cursor: pointer;
  color: var(--vp-c-text-2);
}

.radio-label input {
  accent-color: var(--vp-c-brand-1);
}

.tokens-estimate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--vp-c-brand-soft);
  border-radius: 6px;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.estimate-label {
  color: var(--vp-c-text-2);
}

.estimate-value {
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.comparison-card {
  border-radius: 8px;
  padding: 0.875rem 1rem;
  border: 1px solid var(--vp-c-divider);
}

.comparison-card.competitor {
  background: var(--vp-c-bg-soft);
  border-color: var(--vp-c-divider);
}

.comparison-card.robota {
  background: var(--vp-c-bg-soft);
}

.card-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-bottom: 0.3rem;
}

.card-price {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  line-height: 1;
  margin-bottom: 0.2rem;
}

.card-note {
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.card-savings {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #22c55e;
}

.card-more {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

.disclaimer {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  line-height: 1.5;
  margin: 0 0 1rem;
}

.share-row {
  display: flex;
}

.share-btn {
  background: var(--vp-c-brand-1);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.share-btn:hover {
  opacity: 0.85;
}
</style>
