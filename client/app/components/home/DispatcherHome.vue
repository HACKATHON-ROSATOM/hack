<script setup>
import StatsSection from '~/components/home/dispatcher/StatsSection.vue'
import ActionRequiredSection from '~/components/home/dispatcher/ActionRequiredSection.vue'
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <h1 class="text-2xl font-semibold text-gray-900">Дежурный</h1>
    <StatsSection />
    <ActionRequiredSection />
    <div class="flex justify-end">
      <UButton to="/requests/new">Создать ручную заявку</UButton>
    </div>
  </main>
</template>
