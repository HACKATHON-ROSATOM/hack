<script setup>
import StatCards from '~/components/home/StatCards.vue'

const stats = [
  { label: 'Новые заявки', value: 4 },
  { label: 'Автозаявки без срока', value: 1 },
]
</script>

<template>
  <StatCards :stats="stats" />
</template>
