<script setup>
import StatsSection from '~/components/home/director/StatsSection.vue'
import OverdueRequestsSection from '~/components/home/director/OverdueRequestsSection.vue'
import WorkloadSection from '~/components/home/director/WorkloadSection.vue'
import UnassignedRequestsSection from '~/components/home/director/UnassignedRequestsSection.vue'
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <h1 class="text-2xl font-semibold text-gray-900">Технический директор</h1>
    <StatsSection />
    <OverdueRequestsSection />
    <WorkloadSection />
    <UnassignedRequestsSection />
  </main>
</template>
