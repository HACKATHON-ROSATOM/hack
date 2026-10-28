<script setup>
defineProps({
  stats: {
    type: Array,
    required: true,
  },
})

const colors = {
  warning: { card: 'bg-warning-50 ring-warning-200', value: 'text-warning-700' },
  error: { card: 'bg-error-50 ring-error-200', value: 'text-error-700' },
  success: { card: 'bg-success-50 ring-success-200', value: 'text-success-700' },
}
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <UCard
      v-for="stat in stats"
      :key="stat.label"
      class="min-w-48 flex-1 ring-1"
      :class="colors[stat.color]?.card || 'bg-white ring-brand/15'"
    >
      <p class="text-sm text-gray-600">{{ stat.label }}</p>
      <p class="mt-1 text-2xl font-semibold" :class="colors[stat.color]?.value || 'text-gray-900'">{{ stat.value }}</p>
    </UCard>
  </div>
</template>
