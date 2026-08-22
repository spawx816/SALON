const API_URL = '/api';

const ensureArray = (field) => {
  if (!field) return [];
  
  // Función para "pelar la cebolla" (quitar capas de stringify recursivo)
  const peel = (data) => {
    let current = data;
    let limit = 0;
    while (typeof current === 'string' && limit < 10) {
      try {
        const parsed = JSON.parse(current);
        if (parsed === current) break;
        current = parsed;
        limit++;
      } catch { break; }
    }
    return current;
  };

  const data = peel(field);
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    return data.split(',').map(s => s.trim()).filter(Boolean);
  }
  return data ? [data] : [];
};

export const dataService = {

  // Clients
  getClients: async () => {
    try {
      const res = await fetch(`${API_URL}/clients`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor (${res.status})`);
      }
      return await res.json();
    } catch (e) {
      console.error("Error en getClients:", e);
      throw e;
    }
  },

  saveClient: async (client) => {
    try {
      const res = await fetch(`${API_URL}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server Error');
      return data;
    } catch (e) { 
      throw e; 
    }
  },
  activateAccount: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server Error');
      return data;
    } catch (e) {
      throw e;
    }
  },

  updateClient: async (id, client) => {
    try {
      const res = await fetch(`${API_URL}/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server Error');
      return data;
    } catch (e) {
      throw e;
    }
  },

  findClientByCedula: async (cedula) => {
    try {
      const res = await fetch(`${API_URL}/clients/cedula/${cedula}`);
      if (res.ok) return await res.json();
      return null;
    } catch { return null; }
  },

  // Visits
  getVisits: async () => {
    try {
      const res = await fetch(`${API_URL}/visits`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor (${res.status})`);
      }
      const visits = await res.json();
      return visits.map(v => ({ ...v, servicios: ensureArray(v.servicios) }));
    } catch (e) {
      console.error("Error en getVisits:", e);
      throw e;
    }
  },

  saveVisit: async (visit) => {
    try {
      const res = await fetch(`${API_URL}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visit)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getVisitsByClient: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/visits/client/${clientId}`);
      if (!res.ok) return [];
      const visits = await res.json();
      return visits.map(v => ({ ...v, servicios: ensureArray(v.servicios) }));
    } catch { return []; }
  },

  getPendingSurvey: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/surveys/pending/${clientId}`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  },

  // Surveys
  getSurveys: async () => {
    try {
      const res = await fetch(`${API_URL}/surveys`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  getSurveyStats: async (filters = {}) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const res = await fetch(`${API_URL}/surveys/stats?${params}`);
      return res.ok ? await res.json() : { nps: 0, averages: {}, total: 0, raw: [] };
    } catch { return { nps: 0, averages: {}, total: 0, raw: [] }; }
  },

  submitSurvey: async (clientId, responses) => {
    try {
      const res = await fetch(`${API_URL}/surveys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, responses })
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  checkPendingSurvey: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/surveys/pending/${clientId}`);
      const data = await res.json();
      return data.hasPending;
    } catch { return false; }
  },

  // OTP & Service Deduction
  generateOTP: async (clientId, clientEmail) => {
    try {
      const res = await fetch(`${API_URL}/otp/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientEmail })
      });
      return await res.json();
    } catch (e) { console.error(e); return { error: e.message }; }
  },

  getActiveOTP: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/otp/active/${clientId}`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  },

  verifyOTPAndDiscount: async (clientId, code, visitData) => {
    try {
      const res = await fetch(`${API_URL}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, code, visitData })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código incorrecto');
      return data;
    } catch (e) { throw e; }
  },

  verifyOTP: async (clientId, code) => {
    try {
      const res = await fetch(`${API_URL}/otp/verify-only`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código incorrecto');
      return data;
    } catch (e) { throw e; }
  },

  // Settings
  getEmailSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/settings/email`);
      return res.ok ? await res.json() : {};
    } catch { return {}; }
  },

  saveEmailSettings: async (settings) => {
    try {
      const res = await fetch(`${API_URL}/settings/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  testEmailConnection: async (settings) => {
    try {
      const res = await fetch(`${API_URL}/settings/email/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fallo en la conexión SMTP');
      return data;
    } catch (e) {
      throw e;
    }
  },

  // Marketing Settings & Actions
  getMarketingSettings: () => {
    const data = localStorage.getItem('salon_pro_marketing');
    return data ? JSON.parse(data) : { birthdayDiscount: 15, birthdayFlyerUrl: '', massEmailTemplate: '¡Hola {{nombre}}! Tenemos una oferta para ti.' };
  },

  saveMarketingSettings: (settings) => {
    localStorage.setItem('salon_pro_marketing', JSON.stringify(settings));
  },

  uploadMarketingFlyer: async (base64Data, fileName) => {
    const res = await fetch(`${API_URL}/marketing/upload-flyer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, fileName })
    });
    return await res.json();
  },

  sendMassEmail: async (subject, template) => {
    const res = await fetch(`${API_URL}/marketing/send-mass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, template })
    });
    return await res.json();
  },

  sendBirthdayEmails: async (discountPercent, flyerUrl) => {
    const res = await fetch(`${API_URL}/marketing/send-birthdays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountPercent, flyerUrl })
    });
    return await res.json();
  },

  // Plans
  getPlans: async () => {
    try {
      const res = await fetch(`${API_URL}/plans`);
      if (!res.ok) return [];
      let plans = await res.json();
      plans = plans.map(p => {
        const peeledUsage = (data) => {
          let current = data;
          try {
            while(typeof current === 'string') {
              const p = JSON.parse(current);
              if (typeof p !== 'object' || p === null) break;
              current = p;
            }
          } catch(e) {}
          return typeof current === 'object' ? current : {};
        };

        return { 
          ...p, 
          services: ensureArray(p.services),
          promo_services: ensureArray(p.promo_services),
          usage_limits: peeledUsage(p.usage_limits)
        };
      });
      return plans.length > 0 ? plans : [
        { 
          id: '1', title: 'Plan Diamante', price: '8500.00', discount: 15,
          services: ['Lavado Ilimitado', '4 Secados', '2 Manicuras', 'Tratamiento Especial'],
          color: '#d4af37', location: 'Sede Central'
        }
      ];
    } catch { return []; }
  },

  savePlans: async (plans, applyToExisting = false) => {
    try {
      const res = await fetch(`${API_URL}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans, applyToExisting })
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getDashboardSummary: async () => {
    try {
      const res = await fetch(`${API_URL}/dashboard/summary`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.recentVisits) {
        data.recentVisits = data.recentVisits.map(v => ({
          ...v,
          servicios: ensureArray(v.servicios)
        }));
      }
      return data;
    } catch { return null; }
  },

  getPlanUsages: async () => {
    try {
      const res = await fetch(`${API_URL}/dashboard/plan-usage`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.map(r => ({
        ...r,
        plan_services: Array.isArray(r.plan_services) ? r.plan_services : []
      }));
    } catch { return []; }
  },

  getAnalyticsReports: async (salonId = 'all', startDate = null, endDate = null) => {
    try {
      let url = `${API_URL}/reports/analytics?salon_id=${salonId}`;
      if (startDate) url += `&start_date=${startDate}`;
      if (endDate) url += `&end_date=${endDate}`;
      const res = await fetch(url);
      return res.ok ? await res.json() : null;
    } catch (e) { throw e; }
  },

  async getGiftsByClient(clientId) {
    try {
      const res = await fetch(`/api/gifts?clientId=${clientId}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("Error fetching client gifts:", e);
      return [];
    }
  },

  // Contracts
  getContracts: async () => {
    try {
      const res = await fetch(`${API_URL}/contracts`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  getContractByClient: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/contracts/client/${clientId}`);
      if (res.ok) return await res.json();
      return null;
    } catch { return null; }
  },

  getContractById: async (id) => {
    try {
      const res = await fetch(`${API_URL}/contracts/${id}`);
      if (res.ok) return await res.json();
      return null;
    } catch { return null; }
  },

  unlinkCard: async (clientId) => {
    const res = await fetch(`${API_URL}/clients/${clientId}/unlink-card`, {
      method: 'POST'
    });
    return await res.json();
  },

  getPaymentProfileByClient: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/clients/${clientId}/payment-profile`);
      if (res.ok) return await res.json();
      return null;
    } catch { return null; }
  },

  getPaymentProfilesByClient: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/clients/${clientId}/payment-profiles`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  updatePaymentMethod: async (clientId, pwToken) => {
    const res = await fetch(`${API_URL}/clients/${clientId}/payment-method`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pwToken })
    });
    return await res.json();
  },

  saveContract: async (contract) => {
    try {
      const res = await fetch(`${API_URL}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contract)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  renewManualContract: async (clientId, amount) => {
    try {
      const userStr = localStorage.getItem('salon_pro_user');
      const user = userStr ? JSON.parse(userStr) : null;
      const appliedBy = user ? user.nombre : 'Sistema';
      const salonId = user ? user.salon_id : null;

      const res = await fetch(`${API_URL}/contracts/renew-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, amount, appliedBy, salonId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } catch (e) { 
      throw e; 
    }
  },

  requestContractCode: async (contractId, actionType) => {
    try {
      const res = await fetch(`${API_URL}/contracts/${contractId}/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al solicitar código');
      return data;
    } catch (e) { throw e; }
  },

  confirmContractAction: async (contractId, code, actionType) => {
    try {
      const res = await fetch(`${API_URL}/contracts/${contractId}/confirm-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, actionType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al confirmar acción');
      return data;
    } catch (e) { throw e; }
  },

  // Employees
  getEmployees: async () => {
    try {
      const res = await fetch(`${API_URL}/employees`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  saveEmployee: async (employee) => {
    try {
      const res = await fetch(`${API_URL}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  deleteEmployee: async (id) => {
    try {
      const res = await fetch(`${API_URL}/employees/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  // Appointments
  saveAppointment: async (appointment) => {
    try {
      const res = await fetch(`${API_URL}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointment)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  // Payments
  savePayment: async (payment) => {
    try {
      const userStr = localStorage.getItem('salon_pro_user');
      const user = userStr ? JSON.parse(userStr) : null;
      if (user) {
        payment.appliedBy = user.nombre;
        payment.salonId = user.salon_id;
      }

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getPaymentsByClient: async (clientId) => {
    try {
      const res = await fetch(`${API_URL}/payments/client/${clientId}`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  // Roles & Users
  getRoles: async () => {
    try {
      const res = await fetch(`${API_URL}/roles`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  getBillingStats: async () => {
    try {
      const res = await fetch(`${API_URL}/dashboard/billing-stats`);
      return await res.json();
    } catch (e) { console.error(e); return null; }
  },

  saveRole: async (role) => {
    try {
      const method = role.id ? 'PUT' : 'POST';
      const url = role.id ? `${API_URL}/roles/${role.id}` : `${API_URL}/roles`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(role)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getUsers: async () => {
    try {
      const res = await fetch(`${API_URL}/users`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  saveUser: async (user) => {
    try {
      const method = user.id ? 'PUT' : 'POST';
      const url = user.id ? `${API_URL}/users/${user.id}` : `${API_URL}/users`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  deleteUser: async (id) => {
    try {
      const res = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE' });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  // CardNet Specific Methods
  cardnetCreateCustomer: async (email, clientId) => {
    const res = await fetch(`${API_URL}/cardnet/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, clientId })
    });
    return await res.json();
  },

  cardnetGetCustomer: async (customerId) => {
    const res = await fetch(`${API_URL}/cardnet/customer/${customerId}`);
    return await res.json();
  },

  cardnetActivateProfile: async (customerId, token, activationCode) => {
    const res = await fetch(`${API_URL}/cardnet/customer/${customerId}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, activationCode })
    });
    return await res.json();
  },

  cardnetPurchase: async (payload) => {
    const res = await fetch(`${API_URL}/cardnet/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  cardnetUpdateProfile: async (customerId, paymentProfileId, expiration, enable) => {
    if (!customerId || customerId === 'undefined') {
      return { error: "ID de Cliente de CardNet no encontrado para este cliente." };
    }
    const res = await fetch(`${API_URL}/cardnet/customer/${customerId}/update-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentProfileId, expiration, enable })
    });
    return await res.json();
  },

  cardnetDeleteProfile: async (customerId, paymentProfileId) => {
    if (!customerId || customerId === 'undefined') {
      return { error: "ID de Cliente de CardNet no encontrado para este cliente." };
    }
    const res = await fetch(`${API_URL}/cardnet/customer/${customerId}/delete-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentProfileId })
    });
    return await res.json();
  },

  cardnetChargeProfile: async (customerId, paymentProfileId, amount, description, clientId = null) => {
    if (!customerId || customerId === 'undefined') {
      return { error: "ID de Cliente de CardNet no encontrado para este cliente." };
    }
    const res = await fetch(`${API_URL}/cardnet/customer/${customerId}/charge-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentProfileId, amount, description, clientId })
    });
    return await res.json();
  },

  // Salons
  getSalons: async () => {
    try {
      const res = await fetch(`${API_URL}/salons`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  saveSalon: async (salon) => {
    try {
      const res = await fetch(`${API_URL}/salons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(salon)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  deleteSalon: async (id) => {
    try {
      const res = await fetch(`${API_URL}/salons/${id}`, { method: 'DELETE' });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getBillingStats: async () => {
    try {
      const res = await fetch(`${API_URL}/dashboard/billing-stats`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  },

  logCodeRequest: async (clientId, serviceName, staffName) => {
    try {
      const res = await fetch(`${API_URL}/security/log-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, serviceName, staffName })
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getSecurityRequests: async () => {
    try {
      const res = await fetch(`${API_URL}/security/requests`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  // RRHH (Staff Records)
  getStaffRecords: async () => {
    try {
      const res = await fetch(`${API_URL}/rrhh/staff`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  },

  saveStaffRecord: async (record) => {
    try {
      const res = await fetch(`${API_URL}/rrhh/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  updateStaffRecord: async (id, record) => {
    try {
      const res = await fetch(`${API_URL}/rrhh/staff/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  getCardnetStatus: async () => {
    try {
      const res = await fetch(`${API_URL}/cardnet/status`);
      if (!res.ok) throw new Error("Error del servidor");
      return await res.json();
    } catch (e) {
      return {
        success: false,
        active: false,
        env: 'TEST',
        latency: 0,
        error: e.message,
        message: 'No se pudo contactar con la API de Salon Pro.'
      };
    }
  },

  // === MARKETING ===
  getMarketingSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/marketing/settings`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  },

  saveMarketingSettings: async (settings) => {
    try {
      const res = await fetch(`${API_URL}/marketing/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },

  uploadMarketingFlyer: async (base64Data, fileName) => {
    try {
      const res = await fetch(`${API_URL}/marketing/upload-flyer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, fileName })
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },

  uploadCampaignFlyer: async (base64Data, fileName) => {
    try {
      const res = await fetch(`${API_URL}/marketing/upload-campaign-flyer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, fileName })
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },

  sendMassEmail: async (subject, template, campaignType, flyerUrl) => {
    try {
      const res = await fetch(`${API_URL}/marketing/send-mass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, template, campaignType, flyerUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar');
      return data;
    } catch (e) { throw e; }
  },

  sendBirthdayEmails: async (discountPercent, flyerUrl) => {
    try {
      const res = await fetch(`${API_URL}/marketing/send-birthdays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountPercent, flyerUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar cumpleaños');
      return data;
    } catch (e) { throw e; }
  },

  getMarketingStats: async () => {
    try {
      const res = await fetch(`${API_URL}/marketing/stats`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  },

  saveAttendancePunch: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/attendance/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },

  getAttendanceLogs: async (filters = {}) => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.employeeId) params.append('employeeId', filters.employeeId);
      if (filters.salonId) params.append('salonId', filters.salonId);
      if (filters.status) params.append('status', filters.status);
      if (filters.type) params.append('type', filters.type);
      
      const res = await fetch(`${API_URL}/attendance/history?${params.toString()}`);
      return res.ok ? await res.json() : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  verifyUserPassword: async (id, password) => {
    try {
      const res = await fetch(`${API_URL}/users/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
      });
      return res.ok ? await res.json() : { success: false };
    } catch {
      return { success: false };
    }
  },

  getScheduleOverrides: async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/schedule-overrides`);
      return res.ok ? await res.json() : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  saveScheduleOverride: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/attendance/schedule-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok ? await res.json() : { success: false, error: 'Network error' };
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },

  saveScheduleSwap: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/attendance/schedule-swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok ? await res.json() : { success: false, error: 'Network error' };
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },

  deleteScheduleOverride: async (id) => {
    try {
      const res = await fetch(`${API_URL}/attendance/schedule-override/${id}`, {
        method: 'DELETE'
      });
      return res.ok ? await res.json() : { success: false, error: 'Network error' };
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },

  getAttendancePending: async (filters = {}) => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.employeeId) params.append('employeeId', filters.employeeId);
      if (filters.salonId) params.append('salonId', filters.salonId);
      
      const res = await fetch(`${API_URL}/attendance/pending?${params.toString()}`);
      return res.ok ? await res.json() : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  getAttendanceToday: async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/today`);
      return res.ok ? await res.json() : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  adjustAttendance: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/attendance/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || `HTTP error ${res.status}` };
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },

  notifyPendingAttendance: async (payload) => {
    try {
      const res = await fetch(`${API_URL}/attendance/notify-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || `HTTP error ${res.status}` };
    } catch (e) {
      console.error(e);
      return { success: false, error: e.message };
    }
  },
};

