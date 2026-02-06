import {
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import { appConfig } from 'src/config/app.config'; // .env-dan o'qish uchun

interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private readonly BASE_URL = 'https://notify.eskiz.uz/api';
  private cachedToken: string | null = null;
  private eskizClient: AxiosInstance;

  // --- LOCKING PROPERTIES ---
  private isRefreshing = false;
  private failedQueue: QueueItem[] = [];

  constructor() {
    this.eskizClient = axios.create({ baseURL: this.BASE_URL });
    this.setupInterceptors();
  }

  async onModuleInit() {
    await this.login();
  }

  private setupInterceptors() {
    // --- REQUEST INTERCEPTOR: har bir so'rovga avtomatik token qo'shadi ---
    this.eskizClient.interceptors.request.use((config) => {
      if (this.cachedToken) {
        config.headers['Authorization'] = `Bearer ${this.cachedToken}`;
      }
      return config;
    });

    // --- RESPONSE INTERCEPTOR: 401 bo'lsa token refresh qiladi ---
    this.eskizClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<{ message?: string }>) => {
        const originalRequest = error.config as
          | CustomAxiosRequestConfig
          | undefined;

        // Retry loop himoyasi: bir so'rov faqat 1 marta retry bo'ladi
        if (
          error.response?.status === 401 &&
          error.response?.data?.message === 'Expired' &&
          originalRequest &&
          !originalRequest._retry
        ) {
          originalRequest._retry = true;

          // 1. Agar allaqachon refresh jarayoni ketayotgan bo'lsa
          if (this.isRefreshing) {
            return new Promise<string>((resolve, reject) => {
              this.failedQueue.push({ resolve, reject });
            }).then((token) => {
              originalRequest.headers['Authorization'] = `Bearer ${token}`;
              return this.eskizClient(originalRequest);
            });
          }

          // 2. Birinchi bo'lib kelgan so'rov refreshni boshlaydi
          this.isRefreshing = true;

          try {
            const newToken = await this.refreshToken();
            this.isRefreshing = false;

            // Navbatda turgan barcha so'rovlarni yangi token bilan yuboramiz
            this.processQueue(null, newToken);

            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            return this.eskizClient(originalRequest);
          } catch (refreshError) {
            this.processQueue(refreshError as Error, null);
            this.isRefreshing = false;
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      },
    );
  }

  /** Navbatdagilarni qayta ishlash */
  private processQueue(error: Error | null, token: string | null = null) {
    this.failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else {
        prom.resolve(token!);
      }
    });
    this.failedQueue = [];
  }

  /** SMS jo'natish */
  async sendSms(phone: string, message: string): Promise<boolean> {
    try {
      await this.eskizClient.post('/message/sms/send', {
        mobile_phone: phone,
        message: message,
        from: '4546',
      });

      return true;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        const data = error.response?.data;

        this.logger.error(
          `SMS xatolik ${phone}: [${status}]`,
          data || error.message,
        );

		throw new HttpException(`SMS jo'natishda xatolik `, 400);
	}
      this.logger.error(`SMS kutilmagan xatolik ${phone}:`, error);
      throw new HttpException("SMS jo'natishda kutilmagan xatolik", 500);
    }
  }

  private async getToken(): Promise<string> {
    if (!this.cachedToken) return await this.login();
    return this.cachedToken;
  }

  private async login(): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('email', appConfig.ESKIZ_EMAIL);
      formData.append('password', appConfig.ESKIZ_PASSWORD);

      const response = await axios.post(
        `${this.BASE_URL}/auth/login`,
        formData,
      );
      const token = response.data?.data?.token;

      if (token) {
        this.cachedToken = token;
        this.logger.log('Eskiz: Login muvaffaqiyatli');
        return token;
      }
      throw new Error('Token topilmadi');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Noma'lum xato";
      this.logger.error('Eskiz login xatosi:', msg);
      throw error;
    }
  }

  private async refreshToken(): Promise<string> {
    try {
      const response = await axios.patch(
        `${this.BASE_URL}/auth/refresh`,
        {},
        { headers: { Authorization: `Bearer ${this.cachedToken}` } },
      );

      const newToken = response.data?.data?.token;
      if (newToken) {
        this.cachedToken = newToken;
        this.logger.log('Eskiz: Token yangilandi');
        return newToken;
      }
      return await this.login();
    } catch {
      return await this.login();
    }
  }
}
