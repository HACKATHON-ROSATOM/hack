<script setup>
import StatCards from '~/components/home/StatCards.vue'

const stats = [
  { label: 'Новые', value: 4 },
  { label: 'Просрочены', value: 2 },
  { label: 'Без исполнителя', value: 1 },
]
</script>

<template>
  <StatCards :stats="stats" />
</template>
