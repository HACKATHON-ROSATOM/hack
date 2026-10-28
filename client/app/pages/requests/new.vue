<script setup>
import { useUserStore } from '~/stores/user'
import { typeLabels, priorityLabels, errorMessage, loadEquipment } from '~/components/requests/requestUtils'

const route = useRoute()
const userStore = useUserStore()
const equipment = ref([])
const engineers = ref([])
const equipmentId = ref('')
const assigneeId = ref('unassigned')
const kind = ref('')
const priority = ref('MEDIUM')
const description = ref('')
const due = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const equipmentOptions = computed(() => equipment.value.map((item) => ({ label: `${item.name}${item.externalId ? ` (${item.externalId})` : ''}${item.location ? ` — ${item.location}` : ''}`, value: item.id })))
const engineerOptions = computed(() => [{ label: 'Не назначен', value: 'unassigned' }, ...engineers.value.map((item) => ({ label: item.name, value: item.id }))])
const kindOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))
const priorityOptions = Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))

async function load() {
  loading.value = true
  error.value = ''
  try {
    await userStore.restore()
    if (userStore.role !== 'dispatcher') return
    const [objects, people] = await Promise.all([loadEquipment(userStore), userStore.api('/api/engineers')])
    equipment.value = objects
    engineers.value = people.items
    if (objects.some((item) => item.id === route.query.equipmentId)) equipmentId.value = route.query.equipmentId
  } catch (err) { error.value = errorMessage(err) } finally { loading.value = false }
}
onMounted(load)

async function create() {
  error.value = ''
  if (!kind.value || !equipmentId.value || !description.value.trim() || !priority.value || !due.value || Number.isNaN(new Date(due.value).getTime())) {
    error.value = 'Заполните тип, оборудование, описание, приоритет и корректный срок.'
    return
  }
  saving.value = true
  try {
    const body = { type: kind.value, equipmentId: equipmentId.value, description: description.value.trim(), priority: priority.value, initialDeadline: new Date(due.value).toISOString() }
    if (assigneeId.value !== 'unassigned') body.assigneeId = assigneeId.value
    const created = await userStore.api('/api/requests', { method: 'POST', body })
    await navigateTo(`/requests/${created.id}`)
  } catch (err) { error.value = errorMessage(err) } finally { saving.value = false }
}
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-6 px-4 py-10">
    <h1 class="text-2xl font-semibold text-gray-900">Новая заявка</h1>
    <UCard class="bg-white ring-1 ring-brand/15">
      <p v-if="loading" role="status">Загрузка данных…</p>
      <template v-else-if="userStore.role !== 'dispatcher'"><p>Создание заявок доступно дежурному.</p><UButton to="/requests" variant="link" class="mt-3 p-0">К списку заявок</UButton></template>
      <template v-else>
        <p v-if="error" role="alert" class="mb-4 text-red-700">{{ error }}</p>
        <div v-if="!equipment.length" class="space-y-3"><p>Оборудование не загружено или отсутствует. Создание заявки невозможно.</p><UButton variant="outline" @click="load">Повторить загрузку</UButton></div>
        <form v-else class="space-y-4" @submit.prevent="create">
          <UFormField label="Тип заявки" required><USelect v-model="kind" :items="kindOptions" value-key="value" placeholder="Выберите тип" class="w-full" /></UFormField>
          <UFormField label="Оборудование" required><USelect v-model="equipmentId" :items="equipmentOptions" value-key="value" placeholder="Выберите объект" class="w-full" /></UFormField>
          <UFormField label="Описание" required><UTextarea v-model="description" maxlength="2000" placeholder="Опишите задачу" :rows="4" class="w-full" /></UFormField>
          <UFormField label="Приоритет" required><USelect v-model="priority" :items="priorityOptions" value-key="value" class="w-full" /></UFormField>
          <UFormField label="Плановый срок" required><UInput v-model="due" type="datetime-local" class="w-full" /></UFormField>
          <UFormField label="Исполнитель"><USelect v-model="assigneeId" :items="engineerOptions" value-key="value" class="w-full" /><p v-if="!engineers.length" class="mt-1 text-sm text-gray-600">Нет доступных инженеров. Заявку можно назначить позже.</p></UFormField>
          <div class="flex justify-end gap-2"><UButton to="/requests" variant="outline">Отмена</UButton><UButton type="submit" :loading="saving" :disabled="saving">Создать заявку</UButton></div>
        </form>
      </template>
    </UCard>
  </main>
</template>
