<script setup>
import { useUserStore } from '~/stores/user'

const route = useRoute()
const userStore = useUserStore()

const links = [
  { label: 'Сводка', href: '/' },
  { label: 'Оборудование', href: '/equipment' },
  { label: 'Заявки', href: '/requests' },
  { label: 'Мониторинг', href: '/monitoring' },
]

const roleLabels = {
  dispatcher: 'Дежурный',
  engineer: 'Сервисный инженер',
  director: 'Технический директор',
}

async function logout() {
  userStore.logout()
  await navigateTo('/login')
}

const isActive = (href) =>
  href === '/'
    ? route.path === '/'
    : route.path === href || route.path.startsWith(`${href}/`)
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-3 border-b border-brand/15 bg-white px-4 py-3">
    <nav class="flex w-full items-center gap-4 overflow-x-auto sm:w-auto sm:gap-6" aria-label="Основная навигация">
      <NuxtLink
        v-for="link in links"
        :key="link.href"
        :to="link.href"
        class="shrink-0 border-b-2 pb-1 text-base font-medium hover:text-brand-hover"
        :class="isActive(link.href) ? 'border-brand text-brand' : 'border-transparent text-gray-600'"
      >
        {{ link.label }}
      </NuxtLink>
    </nav>

    <div v-if="userStore.user" class="flex w-full items-center justify-between gap-4 sm:w-auto">
      <div class="text-left sm:text-right">
        <p class="font-medium text-gray-900">{{ userStore.user.name }}</p>
        <p class="text-sm text-gray-500">{{ roleLabels[userStore.role] }}</p>
      </div>
      <UButton color="neutral" variant="outline" @click="logout">Выйти</UButton>
    </div>
  </header>
</template>

