<script setup>
import { requestItems } from '~/data/requests'
import { useUserStore } from '~/stores/user'
import RequestsTable from '~/components/requests/RequestsTable.vue'

const userStore = useUserStore()
const search = ref('')
const kind = ref('all')
const status = ref('all')

const kindOptions = [
  { label: 'Все типы', value: 'all' },
  { label: 'Осмотр', value: 'Осмотр' },
  { label: 'Ремонт', value: 'Ремонт' },
]

const statusOptions = [
  { label: 'Все статусы', value: 'all' },
  { label: 'Новая', value: 'Новая' },
  { label: 'В работе', value: 'В работе' },
  { label: 'Ожидание ЗИП', value: 'Ожидание ЗИП' },
  { label: 'Выполнено', value: 'Выполнено' },
]

const filteredRequests = computed(() => requestItems.filter((request) => {
  const query = search.value.trim().toLowerCase()
  const matchesSearch = [request.id, request.equipment, request.assignee, request.description]
    .join(' ')
    .toLowerCase()
    .includes(query)
  return matchesSearch
    && (kind.value === 'all' || request.kind === kind.value)
    && (status.value === 'all' || request.status === status.value)
}))

const myRequests = computed(() => filteredRequests.value.filter((request) => request.mine))
const availableRequests = computed(() => filteredRequests.value.filter((request) => request.available))
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-gray-900">Заявки</h1>
      <UButton v-if="userStore.role === 'dispatcher'" to="/requests/new">Создать заявку</UButton>
    </div>

    <UCard class="bg-white ring-1 ring-brand/15">
      <div class="flex flex-wrap gap-3">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Поиск по заявкам" aria-label="Поиск по заявкам" class="w-64" />
        <USelect v-model="kind" :items="kindOptions" value-key="value" aria-label="Тип заявки" class="w-44" />
        <USelect v-model="status" :items="statusOptions" value-key="value" aria-label="Статус заявки" class="w-44" />
      </div>
    </UCard>

    <template v-if="userStore.role === 'engineer'">
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Мои назначения</h2>
        <RequestsTable :requests="myRequests" />
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Доступны для взятия</h2>
        <RequestsTable :requests="availableRequests" />
      </UCard>
    </template>

    <UCard v-else class="bg-white ring-1 ring-brand/15">
      <h2 class="mb-4 text-lg font-semibold text-gray-900">Все заявки</h2>
      <RequestsTable :requests="filteredRequests" />
    </UCard>
  </main>
</template>
