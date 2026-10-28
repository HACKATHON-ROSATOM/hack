<script setup>
import StatCards from '~/components/home/StatCards.vue'

const stats = [
  { label: 'Назначены мне', value: 3 },
  { label: 'Срок сегодня', value: 1 },
]
</script>

<template>
  <StatCards :stats="stats" />
</template>
