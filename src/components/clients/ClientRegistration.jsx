import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { User, Phone, CreditCard, Mail, Calendar, Sparkles, ArrowRight, MapPin } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';

import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { formatCedula, validateName, cleanPhone } from '../../utils/formUtils';

const ClientRegistration = ({ initialClient = null, onClientSaved = null, submitButtonText = null, isModal = false }) => {
  const { register, handleSubmit, formState: { errors }, reset, trigger, setValue } = useForm();
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [salons, setSalons] = useState([]);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const loadSalons = async () => {
      const data = await dataService.getSalons();
      setSalons(data);
    };
    loadSalons();
  }, []);

  useEffect(() => {
    if (initialClient) {
      setValue('nombre', initialClient.nombre || initialClient.name || '');
      setValue('telefono', initialClient.telefono || '');
      setValue('email', initialClient.email || '');
      setValue('cedula', initialClient.cedula || '');
      setValue('fechaNacimiento', initialClient.fechaNacimiento || initialClient.fecha_nacimiento || '');
      setValue('salon_id', initialClient.salon_id || '1');
      setValue('calle', initialClient.calle || initialClient.direccion || '');
      setValue('numero', initialClient.numero || '');
      setValue('sector', initialClient.sector || '');
      setValue('ciudad', initialClient.ciudad || 'Santo Domingo');
    }
  }, [initialClient, setValue]);

  const nextStep = async () => {
    const isValid = await trigger(["nombre", "telefono", "email", "cedula", "salon_id"]);
    if (isValid) {
      setStep(2);
    }
  };

  const onSubmit = async (data) => {
    try {
      const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador';
      const source = isAdmin ? 'Admin' : 'Reception';

      let saved = null;
      if (initialClient && initialClient.id) {
        saved = await dataService.updateClient(initialClient.id, {
          ...initialClient,
          ...data
        });
      } else {
        saved = await dataService.saveClient({ ...data, registration_source: source });
      }

      const finalClient = saved || { ...(initialClient || {}), ...data };
      showNotification(t('reg.alert.success'));

      if (onClientSaved) {
        onClientSaved(finalClient);
      } else {
        reset();
        setStep(1);
      }
    } catch (err) {
      if (err.message && err.message.includes('Duplicate entry')) {
        showNotification(`Ups, la Cédula "${data.cedula}" ya se encuentra registrada.`, 'error');
      } else {
        showNotification('Error de servidor: ' + (err.message || err), 'error');
        if (onClientSaved) {
          onClientSaved({ ...(initialClient || {}), ...data });
        }
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step === 1) {
        nextStep();
      } else {
        handleSubmit(onSubmit)();
      }
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: '2rem' }}>
      <div className="form-hero">
        <div className="form-icon-hero">
          <Sparkles size={32} strokeWidth={1.5} />
        </div>
        <h2>{t('reg.title')}</h2>
        <p>{t('reg.subtitle')}</p>
        
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '1.5rem' }}>
          <div style={{ width: '40px', height: '4px', background: step === 1 ? 'var(--primary)' : '#e5e7eb', borderRadius: '2px' }}></div>
          <div style={{ width: '40px', height: '4px', background: step === 2 ? 'var(--primary)' : '#e5e7eb', borderRadius: '2px' }}></div>
        </div>
      </div>

      <div className="surface-card">
        <form onKeyDown={handleKeyDown}>
          
          {step === 1 ? (
            <div className="form-grid" key="step1">
              <div className="input-group">
                <label>{t('reg.name')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><User size={18} /></div>
                  <input 
                    {...register("nombre", { 
                      required: t('reg.error.required'),
                      validate: value => validateName(value) || "El nombre no debe contener números"
                    })} 
                    className="input-field" 
                    placeholder={t('reg.name.ph')}
                    style={errors.nombre ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                  />
                </div>
                {errors.nombre && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.nombre.message}</p>}
              </div>

              <div className="input-group">
                <label>{t('reg.phone')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><Phone size={18} /></div>
                  <input 
                    {...register("telefono", { 
                      required: true,
                      onChange: (e) => { e.target.value = cleanPhone(e.target.value); }
                    })} 
                    className="input-field" 
                    placeholder={t('reg.phone.ph')}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>{t('reg.email')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><Mail size={18} /></div>
                  <input 
                    {...register("email", { required: true })} 
                    className="input-field" 
                    type="email"
                    placeholder={t('reg.email.ph')}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>{t('reg.id')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><CreditCard size={18} /></div>
                  <input 
                    {...register("cedula", { 
                      required: true,
                      minLength: { value: 13, message: "Cédula incompleta" },
                      onChange: (e) => { e.target.value = formatCedula(e.target.value); }
                    })} 
                    className="input-field" 
                    placeholder="000-0000000-0"
                  />
                </div>
                {errors.cedula && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.cedula.message}</p>}
              </div>

              <div className="input-group full-width">
                <label>{t('reg.dob')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><Calendar size={18} /></div>
                  <input 
                    {...register("fechaNacimiento")} 
                    className="input-field" 
                    type="date"
                  />
                </div>
              </div>

              <div className="input-group full-width">
                <label>Sucursal de Registro</label>
                <div className="input-wrapper">
                  <div className="input-icon"><MapPin size={18} /></div>
                  <select 
                    {...register("salon_id", { required: true })} 
                    className="input-field" 
                    style={{ appearance: 'none', background: 'white' }}
                  >
                    <option value="">-- Seleccionar Sucursal --</option>
                    {salons.map(salon => (
                      <option key={salon.id} value={salon.id}>{salon.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div className="form-grid" key="step2">
              <div className="input-group full-width" style={{ marginBottom: '1rem' }}>
                 <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)' }}>{t('reg.address')}</h3>
              </div>

              <div className="input-group full-width">
                <label>{t('reg.street')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><MapPin size={18} /></div>
                  <input 
                    {...register("calle")} 
                    className="input-field" 
                    placeholder={t('reg.street.ph')}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>{t('reg.number')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><Sparkles size={18} /></div>
                  <input 
                    {...register("numero")} 
                    className="input-field" 
                    placeholder={t('reg.number.ph')}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>{t('reg.sector')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><MapPin size={18} /></div>
                  <input 
                    {...register("sector")} 
                    className="input-field" 
                    placeholder={t('reg.sector.ph')}
                  />
                </div>
              </div>

              <div className="input-group full-width">
                <label>{t('reg.city')}</label>
                <div className="input-wrapper">
                  <div className="input-icon"><MapPin size={18} /></div>
                  <input 
                    {...register("ciudad")} 
                    className="input-field" 
                    placeholder={t('reg.city.ph')}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="form-footer">
            <p className="form-note">{t('reg.note')}</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              {step === 2 && (
                <button type="button" onClick={() => setStep(1)} className="btn-secondary">
                  {t('reg.btn.back')}
                </button>
              )}
              {step === 1 ? (
                <button type="button" onClick={nextStep} className="btn-primary">
                  {t('reg.btn.next')}
                  <ArrowRight size={18} />
                </button>
              ) : (
                <button type="button" onClick={handleSubmit(onSubmit)} className="btn-primary">
                  {submitButtonText || 'Crear Perfil'}
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientRegistration;
