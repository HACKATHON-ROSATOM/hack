<script setup>
import { useUserStore } from '~/stores/user'
import DispatcherHome from '~/components/home/DispatcherHome.vue'
import EngineerHome from '~/components/home/EngineerHome.vue'
import DirectorHome from '~/components/home/DirectorHome.vue'

const userStore = useUserStore()
</script>

<template>
  <DispatcherHome v-if="userStore.role === 'dispatcher'" />
  <EngineerHome v-else-if="userStore.role === 'engineer'" />
  <DirectorHome v-else />
</template>
