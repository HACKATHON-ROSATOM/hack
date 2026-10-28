<script setup>
import { useUserStore } from '~/stores/user'
import { apiProblem } from '~/utils/apiProblem'

const route = useRoute()
const userStore = useUserStore()
const equipment = ref(null)
const requests = ref([])
const loading = ref(true)
const error = ref('')
const requestsError = ref('')
const date = value => value ? new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' }) : 'Неизвестно'
const historyColumns = [
  { accessorKey: 'completedOn', header: 'Дата окончания ремонта' },
  { accessorKey: 'workType', header: 'Выполненные работы' },
  { accessorKey: 'statusAtImport', header: 'Состояние в истории' },
]
const currentRequests = computed(() => requests.value.filter(item => item.equipmentId === equipment.value?.id && item.status !== 'COMPLETED'))

async function load() {
  loading.value = true
  error.value = ''
  requestsError.value = ''
  equipment.value = null
  requests.value = []
  try {
    equipment.value = await userStore.api(`/api/equipment/${encodeURIComponent(route.params.id)}`)
    try {
      const result = await userStore.api('/api/requests')
      requests.value = result.items
    } catch (err) {
      requestsError.value = apiProblem(err).detail
    }
  } catch (err) {
    error.value = apiProblem(err).detail
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <p v-if="loading" role="status">Загрузка оборудования…</p>
    <div v-else-if="error" role="alert" class="space-y-2 text-red-700"><p>{{ error }}</p><UButton variant="outline" @click="load">Повторить</UButton></div>
    <template v-else-if="equipment">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h1 class="text-2xl font-semibold text-gray-900">{{ equipment.name }}</h1><p class="mt-1 text-sm text-gray-600">ID {{ equipment.externalId || 'Неизвестно' }}</p></div>
        <UButton v-if="userStore.role === 'dispatcher'" :to="{ path: '/requests/new', query: { equipmentId: equipment.id } }">Создать заявку</UButton>
      </div>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Атрибуты оборудования</h2>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-gray-600">Наименование оборудования</dt><dd>{{ equipment.name || 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Типовой ОР</dt><dd>{{ equipment.typicalRepairObject || 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Дата ввода в эксплуатацию</dt><dd>{{ date(equipment.commissionedOn) }}</dd></div>
          <div><dt class="text-sm text-gray-600">Дата выпуска</dt><dd>{{ date(equipment.manufacturedOn) }}</dd></div>
          <div><dt class="text-sm text-gray-600">График работы</dt><dd>{{ equipment.workSchedule || 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Срок полезного использования</dt><dd>{{ equipment.usefulLifeMonths != null ? `${equipment.usefulLifeMonths} мес.` : 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Инвентарный №</dt><dd>{{ equipment.inventoryNumber || 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Комментарий</dt><dd>{{ equipment.comment || 'Неизвестно' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Расположение</dt><dd>{{ [equipment.hierarchyLevel0, equipment.hierarchyLevel1, equipment.hierarchyLevel2, equipment.hierarchyLevel3, equipment.hierarchyLevel4, equipment.hierarchyLevel5, equipment.hierarchyLevel6].filter(Boolean).join(' / ') || 'Неизвестно' }}</dd></div>
        </dl>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">История обслуживания и ремонтов</h2>
        <UTable v-if="equipment.history.length" :data="equipment.history" :columns="historyColumns">
          <template #completedOn-cell="{ row }">{{ date(row.original.completedOn) }}</template>
          <template #workType-cell="{ row }">{{ row.original.workType || 'Неизвестно' }}</template>
          <template #statusAtImport-cell="{ row }">{{ row.original.statusAtImport || 'Неизвестно' }}</template>
        </UTable>
        <p v-else class="text-sm text-gray-600">Записей пока нет.</p>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-2 text-lg font-semibold text-gray-900">Текущие заявки</h2>
        <p v-if="requestsError" role="alert" class="text-sm text-red-700">{{ requestsError }}</p>
        <ul v-else-if="currentRequests.length" class="space-y-2"><li v-for="item in currentRequests" :key="item.id"><NuxtLink class="text-brand underline" :to="`/requests/${item.id}`">Заявка №{{ item.ticketNumber }} — {{ item.description }}</NuxtLink></li></ul>
        <p v-else class="text-sm text-gray-600">Текущих заявок нет.</p>
      </UCard>
    </template>
  </main>
</template>
