<template>
  <el-dialog
    :model-value="visible"
    :width="dialogWidth"
    destroy-on-close
    class="auth-dialog"
    @update:model-value="$emit('update:visible', $event)"
  >
    <!-- Tab Switcher -->
    <div class="flex mb-6 bg-gray-50 rounded-8 p-1 relative">
      <button
        class="flex-1 py-2 text-center text-small font-semibold transition-all rounded-6 inline-flex items-center justify-center gap-1"
        :class="
          mode === 'login'
            ? 'bg-white text-primary-pink shadow-sm'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="mode = 'login'"
      >
        <el-icon :size="16"><User /></el-icon>
        登录
      </button>
      <button
        class="flex-1 py-2 text-center text-small font-semibold transition-all rounded-6 inline-flex items-center justify-center gap-1"
        :class="
          mode === 'register'
            ? 'bg-white text-primary-pink shadow-sm'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="mode = 'register'"
      >
        <el-icon :size="16"><EditPen /></el-icon>
        注册
      </button>
    </div>

    <!-- Login Form -->
    <el-form
      v-if="mode === 'login'"
      ref="loginFormRef"
      :model="loginForm"
      :rules="loginRules"
      label-position="top"
      @submit.prevent="handleLogin"
    >
      <el-form-item label="用户名" prop="username">
        <el-input v-model="loginForm.username" placeholder="请输入用户名" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="loginForm.password"
          type="password"
          show-password
          placeholder="请输入密码"
        />
      </el-form-item>
      <el-button
        class="btn-gradient w-full"
        native-type="submit"
        :loading="loading"
        @click="handleLogin"
      >
        登录
      </el-button>
    </el-form>

    <!-- Register Form -->
    <el-form
      v-else
      ref="registerFormRef"
      :model="registerForm"
      :rules="registerRules"
      label-position="top"
      @submit.prevent="handleRegister"
    >
      <el-form-item label="用户名" prop="username">
        <el-input v-model="registerForm.username" placeholder="请输入用户名" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="registerForm.password"
          type="password"
          show-password
          placeholder="至少 6 位密码"
        />
      </el-form-item>
      <el-form-item label="邀请码" prop="invite_code">
        <el-input v-model="registerForm.invite_code" placeholder="请输入邀请码" />
      </el-form-item>
      <el-button
        class="btn-gradient w-full"
        native-type="submit"
        :loading="loading"
        @click="handleRegister"
      >
        注册
      </el-button>
    </el-form>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import { ElMessage, type FormInstance } from 'element-plus'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  success: []
}>()

const api = useApi()
const { setAuth } = useAuth()
const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const loginFormRef = ref<FormInstance>()
const registerFormRef = ref<FormInstance>()

const loginForm = reactive({
  username: '',
  password: ''
})

const registerForm = reactive({
  username: '',
  password: '',
  invite_code: ''
})

const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

const registerRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  invite_code: [{ required: true, message: '请输入邀请码', trigger: 'blur' }]
}

const dialogWidth = ref(window.innerWidth < 768 ? '95%' : '400px')

function onResize() {
  dialogWidth.value = window.innerWidth < 768 ? '95%' : '400px'
}

onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

async function handleLogin() {
  if (!loginFormRef.value) return
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const res = await api.login(loginForm.username, loginForm.password)
    setAuth(res.access_token, res.user)
    ElMessage.success('登录成功')
    emit('success')
    emit('update:visible', false)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '登录失败')
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  if (!registerFormRef.value) return
  const valid = await registerFormRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const res = await api.register(
      registerForm.username,
      registerForm.password,
      registerForm.invite_code
    )
    setAuth(res.access_token, res.user)
    ElMessage.success('注册成功')
    emit('success')
    emit('update:visible', false)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '注册失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      loginForm.username = ''
      loginForm.password = ''
      registerForm.username = ''
      registerForm.password = ''
      registerForm.invite_code = ''
    }
  }
)
</script>

<style scoped>
.auth-dialog :deep(.el-dialog) {
  border-radius: 12px;
  overflow: hidden;
}
.auth-dialog :deep(.el-dialog__header) {
  display: none;
}
.auth-dialog :deep(.el-dialog__body) {
  padding-top: 4px;
}
.auth-dialog :deep(.el-form-item__label) {
  font-weight: 500;
  color: var(--text-color-secondary);
}
</style>
