<script setup>
import { useUserStore } from '~/stores/user'
import { typeLabels, priorityLabels, loadEquipment } from '~/components/requests/requestUtils'
import { apiProblem } from '~/utils/apiProblem'

const route = useRoute()
const userStore = useUserStore()
const equipment = ref([])
const engineers = ref([])
const state = reactive({
  kind: '',
  equipmentId: '',
  description: '',
  priority: 'MEDIUM',
  due: '',
  assigneeId: 'unassigned',
})
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const equipmentOptions = computed(() => equipment.value.map((item) => ({
  label: `${item.name}${item.externalId ? ` (${item.externalId})` : ''}${item.location ? ` — ${item.location}` : ''}`,
  value: item.id,
})))
const engineerOptions = computed(() => [
  { label: 'Не назначен', value: 'unassigned' },
  ...engineers.value.map((item) => ({ label: item.name, value: item.id })),
])
const kindOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))
const priorityOptions = Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (userStore.role !== 'dispatcher') return
    const [objects, people] = await Promise.all([loadEquipment(userStore), userStore.api('/api/engineers')])
    equipment.value = objects
    engineers.value = people.items
    if (objects.some((item) => item.id === route.query.equipmentId)) {
      state.equipmentId = route.query.equipmentId
    }
  } catch (err) {
    error.value = apiProblem(err).detail
  } finally {
    loading.value = false
  }
}
onMounted(load)

function validate(value) {
  const errors = []
  if (!value.kind) errors.push({ name: 'kind', message: 'Выберите тип заявки.' })
  if (!value.equipmentId) errors.push({ name: 'equipmentId', message: 'Выберите оборудование.' })
  if (!value.description.trim()) errors.push({ name: 'description', message: 'Введите описание.' })
  if (!value.priority) errors.push({ name: 'priority', message: 'Выберите приоритет.' })
  if (!value.due || Number.isNaN(new Date(value.due).getTime())) errors.push({ name: 'due', message: 'Укажите корректный срок.' })
  return errors
}

async function create() {
  formError.value = ''
  saving.value = true
  try {
    const body = {
      type: state.kind,
      equipmentId: state.equipmentId,
      description: state.description.trim(),
      priority: state.priority,
      initialDeadline: new Date(state.due).toISOString(),
    }
    if (state.assigneeId !== 'unassigned') body.assigneeId = state.assigneeId
    const created = await userStore.api('/api/requests', { method: 'POST', body })
    await navigateTo(`/requests/${created.id}`)
  } catch (err) {
    formError.value = apiProblem(err).detail
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-6 px-4 py-10">
    <h1 class="text-2xl font-semibold text-gray-900">Новая заявка</h1>
    <UCard class="bg-white ring-1 ring-brand/15">
      <p v-if="loading" role="status">Загрузка данных…</p>
      <template v-else-if="userStore.role !== 'dispatcher'"><p>Создание заявок доступно дежурному.</p><UButton color="primary" to="/requests" variant="link" class="mt-3 p-0">К списку заявок</UButton></template>
      <template v-else>
        <p v-if="error" role="alert" class="mb-4 text-red-700">{{ error }}</p>
        <div v-if="!equipment.length" class="space-y-3"><p>Оборудование не загружено или отсутствует. Создание заявки невозможно.</p><UButton color="warning" @click="load">Повторить загрузку</UButton></div>
        <UForm v-else :state="state" :validate="validate" class="space-y-4" @submit="create">
          <UFormField name="kind" label="Тип заявки" required><USelect v-model="state.kind" :items="kindOptions" value-key="value" placeholder="Выберите тип" class="w-full" /></UFormField>
          <UFormField name="equipmentId" label="Оборудование" required><USelect v-model="state.equipmentId" :items="equipmentOptions" value-key="value" placeholder="Выберите объект" class="w-full" /></UFormField>
          <UFormField name="description" label="Описание" required><UTextarea v-model="state.description" maxlength="2000" placeholder="Опишите задачу" :rows="4" class="w-full" /></UFormField>
          <UFormField name="priority" label="Приоритет" required><USelect v-model="state.priority" :items="priorityOptions" value-key="value" class="w-full" /></UFormField>
          <UFormField name="due" label="Плановый срок" required><UInput v-model="state.due" type="datetime-local" class="w-full" /></UFormField>
          <UFormField name="assigneeId" label="Исполнитель"><USelect v-model="state.assigneeId" :items="engineerOptions" value-key="value" class="w-full" /><p v-if="!engineers.length" class="mt-1 text-sm text-gray-600">Нет доступных инженеров. Заявку можно назначить позже.</p></UFormField>
          <p v-if="formError" role="alert" class="text-red-700">{{ formError }}</p>
          <div class="flex justify-end gap-2"><UButton color="error" variant="soft" to="/requests">Отмена</UButton><UButton color="primary" type="submit" :loading="saving" :disabled="saving">Создать заявку</UButton></div>
        </UForm>
      </template>
    </UCard>
  </main>
</template>
