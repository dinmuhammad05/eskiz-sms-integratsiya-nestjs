import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

// 1. MOCKING CONFIG
jest.mock('../../config/app.config', () => ({
  appConfig: {
    ESKIZ_EMAIL: 'test@mail.com',
    ESKIZ_PASSWORD: 'test_password',
  },
}));

jest.mock('./prompts/errorPrompt', () => ({
  errorPrompt: {
    smsError: 'SMS yuborishda xatolik',
  },
}));

// Interceptorlarni tutib olish uchun global mock funksiyalar
const requestInterceptorUseSpy = jest.fn();
const responseInterceptorUseSpy = jest.fn();

const mockAxiosInstance = jest.fn() as any;
mockAxiosInstance.post = jest.fn();
mockAxiosInstance.interceptors = {
  request: { use: requestInterceptorUseSpy },
  response: { use: responseInterceptorUseSpy },
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockAxiosInstance),
  post: jest.fn(),
  patch: jest.fn(),
}));

import { SmsService } from './sms.service';

describe('SmsService Locking & Queue Logic', () => {
  let service: SmsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SmsService],
    }).compile();
    service = module.get<SmsService>(SmsService);
  });

  it('should only call refreshToken once even if multiple requests fail simultaneously (Locking)', async () => {
    // A. Response interceptorni ajratib olamiz
    const errorHandler = responseInterceptorUseSpy.mock.calls[0][1];

    // B. Bir vaqtda kelgan 3 ta xato so'rovni simulyatsiya qilamiz
    const createExpiredError = (id: string) => ({
      config: { headers: {}, method: 'post', url: '/test', _id: id },
      response: { status: 401, data: { message: 'Expired' } },
      isAxiosError: true,
    });

    const error1 = createExpiredError('req1');
    const error2 = createExpiredError('req2');
    const error3 = createExpiredError('req3');

    // C. Refresh token (patch) faqat 1 marta muvaffaqiyatli javob beradi (sekinroq javob berishini simulyatsiya qilamiz)
    (axios.patch as jest.Mock).mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ data: { data: { token: 'new_token_123' } } }), 50)
    ));

    // D. Retry qilinganda (this.eskizClient) muvaffaqiyatli javob
    mockAxiosInstance.mockResolvedValue({ data: { status: 'success' } });

    // E. Parallel ravishda 3 ta xatoni interceptorga beramiz
    const results = await Promise.all([
      errorHandler(error1),
      errorHandler(error2),
      errorHandler(error3)
    ]);

    // F. TEKSHIRUVLAR (ASSERTIONS)
    
    // 1. Refresh token faqat 1 marta chaqirilgan bo'lishi kerak! (Eng muhimi)
    expect(axios.patch).toHaveBeenCalledTimes(1);

    // 2. Jami 3 ta retry amalga oshirilgan bo'lishi kerak
    expect(mockAxiosInstance).toHaveBeenCalledTimes(3);

    // 3. Hamma so'rovlar muvaffaqiyatli yakunlangan bo'lishi kerak
    results.forEach(res => {
      expect(res.data.status).toBe('success');
    });

    // 4. Headerlar yangilanganini tekshirish
    expect(mockAxiosInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new_token_123' })
      })
    );
  });
});