<script setup>
import { useUserStore } from '~/stores/user'
import StatCards from '~/components/home/StatCards.vue'

const userStore = useUserStore()
const requests = ref([])
const workload = ref([])
const engineers = ref([])
const loading = ref(true)
const error = ref('')
const roleTitle = computed(() => ({ dispatcher: 'Дежурный', engineer: 'Инженер', director: 'Технический директор' })[userStore.role] || 'Сводка')
const relevant = computed(() => userStore.role === 'engineer'
  ? requests.value.filter(item => item.assigneeId === userStore.user?.id)
  : requests.value)
const active = computed(() => relevant.value.filter(item => item.status !== 'COMPLETED'))
const overdue = computed(() => active.value.filter(item => item.isOverdue))
const unassigned = computed(() => active.value.filter(item => !item.assigneeId))
const stats = computed(() => [
  { label: 'Активные заявки', value: active.value.length },
  { label: 'Просроченные', value: overdue.value.length },
  { label: 'Завершённые', value: relevant.value.filter(item => item.status === 'COMPLETED').length },
  ...(userStore.role === 'engineer' ? [] : [{ label: 'Без исполнителя', value: unassigned.value.length }]),
])
const statusLabels = { NEW: 'Новая', IN_PROGRESS: 'В работе', WAITING_PARTS: 'Ожидание запчастей', COMPLETED: 'Завершена' }
const workloadRows = computed(() => engineers.value
  .filter(person => userStore.role !== 'engineer' || person.id === userStore.user?.id)
  .map(person => ({
    engineerId: person.id,
    name: person.name,
    activeTicketsCount: workload.value.find(item => item.engineerId === person.id)?.activeTicketsCount ?? 0,
  })))
const columns = [
  { accessorKey: 'ticketNumber', header: 'Заявка' },
  { accessorKey: 'description', header: 'Описание' },
  { accessorKey: 'status', header: 'Статус' },
  { accessorKey: 'currentDeadline', header: 'Срок' },
  { id: 'actions', header: 'Действие' },
]
const workloadColumns = [{ accessorKey: 'name', header: 'Инженер' }, { accessorKey: 'activeTicketsCount', header: 'Активных заявок' }]

async function load() {
  loading.value = true
  error.value = ''
  try {
    await userStore.restore()
    const [tickets, loads, people] = await Promise.all([
      userStore.api('/api/requests'),
      userStore.api('/api/requests/analytics/workload'),
      userStore.api('/api/engineers'),
    ])
    requests.value = tickets.items
    workload.value = loads.items
    engineers.value = people.items
  } catch (err) {
    error.value = err.data?.detail || err.message || 'Не удалось загрузить сводку.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-gray-900">{{ roleTitle }}</h1>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="userStore.role === 'dispatcher'" to="/requests/new">Создать заявку</UButton>
        <UButton to="/requests" variant="outline">Все заявки</UButton>
      </div>
    </div>
    <p v-if="loading" role="status" class="text-sm text-gray-600">Загрузка сводки…</p>
    <div v-else-if="error" role="alert" class="space-y-2 text-sm text-red-700"><p>{{ error }}</p><UButton variant="outline" @click="load">Повторить</UButton></div>
    <template v-else>
      <StatCards :stats="stats" />
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">{{ userStore.role === 'engineer' ? 'Мои активные заявки' : 'Активные заявки' }}</h2>
        <p v-if="!active.length" class="text-sm text-gray-600">Активных заявок нет.</p>
        <UTable v-else :data="active" :columns="columns">
          <template #ticketNumber-cell="{ row }">№{{ row.original.ticketNumber }}</template>
          <template #status-cell="{ row }">{{ statusLabels[row.original.status] || 'Неизвестно' }}<span v-if="row.original.isOverdue" class="ml-2 text-red-700">Просрочена</span></template>
          <template #currentDeadline-cell="{ row }">{{ row.original.currentDeadline ? new Date(row.original.currentDeadline).toLocaleString('ru-RU') : 'Неизвестно' }}</template>
          <template #actions-cell="{ row }"><UButton :to="`/requests/${row.original.id}`" variant="outline">Открыть</UButton></template>
        </UTable>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">{{ userStore.role === 'engineer' ? 'Моя нагрузка' : 'Нагрузка инженеров' }}</h2>
        <p v-if="!workloadRows.length" class="text-sm text-gray-600">Нет данных о нагрузке.</p>
        <UTable v-else :data="workloadRows" :columns="workloadColumns" />
      </UCard>
    </template>
  </main>
</template>
