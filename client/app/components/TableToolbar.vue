<script setup>
defineProps({
  filterOptions: {
    type: Array,
    default: () => [],
  },
})

const filter = ref()
</script>

<template>
  <div class="mb-4 flex flex-wrap items-center gap-3">
    <UInput icon="i-lucide-search" placeholder="Поиск" class="w-64" />
    <USelect
      v-if="filterOptions.length"
      v-model="filter"
      :items="filterOptions"
      value-key="value"
      icon="i-lucide-list-filter"
      placeholder="Фильтр"
      class="w-56"
    />
  </div>
</template>
