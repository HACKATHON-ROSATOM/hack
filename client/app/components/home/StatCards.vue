<script setup>
defineProps({
  stats: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <UCard
      v-for="stat in stats"
      :key="stat.label"
      class="min-w-48 flex-1 bg-white ring-1 ring-brand/15"
    >
      <p class="text-sm text-gray-600">{{ stat.label }}</p>
      <p class="mt-1 text-2xl font-semibold text-gray-900">{{ stat.value }}</p>
    </UCard>
  </div>
</template>
