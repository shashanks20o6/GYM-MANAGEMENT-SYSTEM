(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch {
      return '#';
    }
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
  }

  function formatDate(value) {
    if (!value) return '—';
    const raw = String(value).slice(0, 10);
    const parts = raw.split('-');
    if (parts.length !== 3) return escapeHtml(value);
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatTime(value) {
    if (!value) return '—';
    return String(value).slice(0, 8);
  }

  function showMessage(message, type = 'success') {
    const box = $('#form-message');
    if (!box) return;
    box.className = `alert alert-${type}`;
    box.textContent = message;
    box.classList.remove('d-none');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearMessage() {
    const box = $('#form-message');
    if (box) {
      box.className = 'alert d-none';
      box.textContent = '';
    }
  }

  async function api(url, options = {}) {
    const config = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (config.body && typeof config.body !== 'string') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !['/api/auth/login', '/api/auth/register'].includes(url)) {
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      throw new Error(payload.message || 'The request could not be completed.');
    }
    return payload;
  }

  function statusPill(status) {
    const normalized = String(status || 'Pending');
    const css = normalized === 'Approved' || normalized === 'Paid' || normalized === 'Active' || normalized === 'Completed'
      ? 'status-success'
      : normalized === 'Rejected' || normalized === 'Failed' || normalized === 'Expired' || normalized === 'Refunded'
        ? 'status-danger' : 'status-pending';
    return `<span class="status-pill ${css}">${escapeHtml(normalized)}</span>`;
  }

  function statCard(label, value, icon) {
    return `<article class="stat-card"><div class="stat-icon">${icon}</div><div><p>${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong></div></article>`;
  }

  function emptyState(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function renderRows(rows, columns) {
    if (!rows.length) return `<tr><td colspan="${columns}" class="text-secondary">No records yet.</td></tr>`;
  }

  async function initLogin() {
    $('#login-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const form = event.currentTarget;
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      try {
        const formData = Object.fromEntries(new FormData(form).entries());
        const result = await api('/api/auth/login', { method: 'POST', body: formData });
        // This copy is only for client-side display. Server authorization uses the HttpOnly session.
        localStorage.setItem('user', JSON.stringify(result.user));
        window.location.href = result.redirect;
      } catch (error) {
        showMessage(error.message, 'danger');
      } finally {
        submit.disabled = false;
      }
    });
  }

  function requiredFieldsForRole(role) {
    const names = {
      Gym_owners: ['gym_name', 'location', 'platform_plan_id', 'payment_method'],
      Trainers: ['first_name', 'last_name', 'gym_id', 'base_salary'],
      Members: ['first_name', 'last_name', 'gym_id']
    };
    return names[role] || [];
  }

  function syncRoleFields() {
    const role = $('#role')?.value;
    $$('[data-role-fields]').forEach((section) => {
      const active = section.dataset.roleFields === role;
      section.hidden = !active;
      $$('input, select, textarea', section).forEach((field) => {
        field.disabled = !active;
        field.required = active && requiredFieldsForRole(role).includes(field.name);
      });
    });
  }

  async function loadApprovedGyms() {
    try {
      const { gyms } = await api('/api/auth/gyms');
      $$('.gym-select').forEach((select) => {
        select.innerHTML = '<option value="">Select a gym</option>' + gyms.map((gym) =>
          `<option value="${Number(gym.gym_id)}">${escapeHtml(gym.gym_name)} — ${escapeHtml(gym.location)}</option>`
        ).join('');
        if (!gyms.length) select.innerHTML = '<option value="">No approved gyms are available yet</option>';
      });
    } catch (error) {
      $$('.gym-select').forEach((select) => { select.innerHTML = '<option value="">Could not load gyms</option>'; });
    }
  }

  async function loadAvailablePlatformPlans() {
    const select = $('#registration-platform-plan');
    if (!select) return;
    try {
      const { plans } = await api('/api/auth/platform-plans');
      select.innerHTML = '<option value="">Choose a platform plan</option>' + plans.map((plan) =>
        `<option value="${Number(plan.platform_plan_id)}">${escapeHtml(plan.plan_name)} — ${Number(plan.duration_months)} month(s) — ${formatMoney(plan.price)}</option>`
      ).join('');
      if (!plans.length) select.innerHTML = '<option value="">No active plans available — contact the Super Admin</option>';
    } catch (error) {
      select.innerHTML = '<option value="">Could not load platform plans</option>';
      showMessage(error.message, 'danger');
    }
  }

  async function initRegister() {
    const roleSelect = $('#role');
    roleSelect?.addEventListener('change', syncRoleFields);
    syncRoleFields();
    await Promise.all([loadApprovedGyms(), loadAvailablePlatformPlans()]);

    $('#register-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const result = await api('/api/auth/register', { method: 'POST', body: data });
        showMessage(`${result.message} You can sign in after approval.`, 'success');
        form.reset();
        syncRoleFields();
      } catch (error) {
        showMessage(error.message, 'danger');
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function confirmCurrentUser() {
    const { user } = await api('/api/auth/me');
    localStorage.setItem('user', JSON.stringify(user));
    const name = $('#nav-username');
    if (name) name.textContent = user.username;
    $('#logout-button')?.addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* Clear client state regardless. */ }
      localStorage.removeItem('user');
      window.location.href = '/login';
    });
    return user;
  }

  async function initSuperAdmin() {
    const data = await api('/api/admin/overview');
    $('#stats').innerHTML = [
      statCard('Total gyms', data.stats.totalGyms, '⌂'),
      statCard('Approved owners', data.stats.approvedOwners, '✓'),
      statCard('Pending owners', data.stats.pendingOwners, '◷'),
      statCard('Net platform revenue', formatMoney(data.stats.platformRevenue), '₹'),
      statCard('Total refunds', formatMoney(data.stats.totalRefunded), '↩'),
      statCard('Active subscriptions', data.stats.activeSubscriptions, '♧')
    ].join('');

    $('#pending-count').textContent = data.pendingOwners.length;
    $('#pending-owners').innerHTML = data.pendingOwners.length ? data.pendingOwners.map((owner) => `
      <article class="approval-card">
        <div class="approval-main"><div class="avatar-circle">${escapeHtml((owner.gym_name || 'G').slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(owner.gym_name)}</strong><p>${escapeHtml(owner.username)} · ${escapeHtml(owner.email)}</p><small>${escapeHtml(owner.location)} · Account #${owner.user_id}</small><small>Registration payment: ${escapeHtml(owner.plan_name_snapshot || 'No plan')} · ${formatMoney(owner.amount || 0)} · ${statusPill(owner.payment_status || 'Unpaid')}</small></div></div>
        <div class="approval-actions"><button class="btn btn-sm btn-primary" data-admin-action="approve" data-user-id="${owner.user_id}">Approve</button><button class="btn btn-sm btn-outline-danger" data-admin-action="reject" data-user-id="${owner.user_id}">Reject</button></div>
      </article>`).join('') : emptyState('There are no pending Gym Owner registrations.');

    $('#gyms-table').innerHTML = data.gyms.length ? data.gyms.map((gym) => `
      <tr>
        <td><strong>${escapeHtml(gym.gym_name)}</strong><div class="table-subtext">Gym #${gym.gym_id}</div></td>
        <td>${escapeHtml(gym.location)}</td>
        <td>${escapeHtml(gym.owner_username)}<div class="table-subtext">${escapeHtml(gym.owner_email)}</div></td>
        <td>${statusPill(gym.owner_status)}</td>
        <td>${escapeHtml(gym.subscription_plan || '—')}</td>
        <td>${statusPill(gym.subscription_status)}</td>
        <td>${formatDate(gym.subscription_end_date)}</td>
      </tr>`).join('') : renderRows([], 7);

    $('#platform-plans').innerHTML = data.subscriptionPlans.length ? data.subscriptionPlans.map((plan) => {
      const active = Number(plan.is_active) === 1 || plan.is_active === true;
      return `<div class="compact-item">
        <div><strong>${escapeHtml(plan.plan_name)} · ${formatMoney(plan.price)}</strong><small>${Number(plan.duration_months)} month(s) · ${Number(plan.purchase_count)} purchase(s)${plan.description ? ` · ${escapeHtml(plan.description)}` : ''}</small><small>${active ? 'Available to Gym Owners' : 'Not available for new purchases'}</small></div>
        <button class="btn btn-sm ${active ? 'btn-outline-danger' : 'btn-outline-primary'}" type="button" data-platform-plan-status data-plan-id="${plan.platform_plan_id}" data-next-status="${active ? '0' : '1'}">${active ? 'Deactivate' : 'Activate'}</button>
      </div>`;
    }).join('') : emptyState('No platform subscription plans yet. Create your first plan using the form.');

    $('#platform-payments-table').innerHTML = data.platformPayments.length ? data.platformPayments.map((payment) => `
      <tr>
        <td><strong>${escapeHtml(payment.transaction_reference)}</strong><div class="table-subtext">#${payment.owner_subscription_id}</div></td>
        <td><strong>${escapeHtml(payment.gym_name)}</strong><div class="table-subtext">${escapeHtml(payment.owner_username)} · ${escapeHtml(payment.owner_email)}</div></td>
        <td>${escapeHtml(payment.plan_name_snapshot)}</td>
        <td><strong>${formatMoney(payment.amount)}</strong></td>
        <td>${escapeHtml(payment.payment_method)}</td>
        <td>${statusPill(payment.payment_status)}<div class="table-subtext">Owner: ${escapeHtml(payment.owner_review_status)} · Refund: ${escapeHtml(payment.refund_status)}</div><div class="table-subtext">${escapeHtml(payment.subscription_status)}</div></td>
        <td>${formatDate(payment.start_date)} – ${formatDate(payment.end_date)}</td>
        <td>${formatDate(payment.paid_at)}${payment.refunded_at ? `<div class="table-subtext">Refunded ${formatDate(payment.refunded_at)}</div>` : ''}</td>
        <td>${payment.refund_status === 'Available' && payment.payment_status === 'Paid' ? `<button class="btn btn-sm btn-outline-danger" type="button" data-admin-refund="${payment.owner_subscription_id}">Record refund</button>` : payment.refund_reference ? `<span class="small text-secondary">${escapeHtml(payment.refund_reference)}</span>` : '—'}</td>
      </tr>`).join('') : renderRows([], 9);

    if (!$('#platform-payments-table').dataset.bound) {
      $('#platform-payments-table').dataset.bound = 'true';
      $('#platform-payments-table').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-refund]');
        if (!button) return;
        if (!window.confirm('Record this rejected Gym Owner payment as refunded? This updates the demo ledger and reduces net platform revenue. It does not transfer real money.')) return;
        button.disabled = true;
        try {
          const result = await api(`/api/admin/subscriptions/${button.dataset.adminRefund}/refund`, { method: 'PATCH', body: {} });
          showMessage(result.message);
          await initSuperAdmin();
        } catch (error) {
          showMessage(error.message, 'danger');
          button.disabled = false;
        }
      });
    }

    if (!$('#pending-owners').dataset.bound) {
      $('#pending-owners').dataset.bound = 'true';
      $('#pending-owners').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-action]');
        if (!button) return;
        button.disabled = true;
        try {
          const action = button.dataset.adminAction;
          const result = await api(`/api/admin/owners/${button.dataset.userId}/${action}`, { method: 'PATCH' });
          showMessage(result.message);
          await initSuperAdmin();
        } catch (error) { showMessage(error.message, 'danger'); button.disabled = false; }
      });
    }

    if (!$('#create-platform-plan-form').dataset.bound) {
      $('#create-platform-plan-form').dataset.bound = 'true';
      $('#create-platform-plan-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMessage();
        const form = event.currentTarget;
        try {
          const result = await api('/api/admin/subscription-plans', {
            method: 'POST',
            body: Object.fromEntries(new FormData(form).entries())
          });
          showMessage(result.message);
          form.reset();
          await initSuperAdmin();
        } catch (error) {
          showMessage(error.message, 'danger');
        }
      });
    }

    if (!$('#platform-plans').dataset.bound) {
      $('#platform-plans').dataset.bound = 'true';
      $('#platform-plans').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-platform-plan-status]');
        if (!button) return;
        button.disabled = true;
        try {
          const result = await api(`/api/admin/subscription-plans/${button.dataset.planId}/status`, {
            method: 'PATCH',
            body: { is_active: button.dataset.nextStatus === '1' }
          });
          showMessage(result.message);
          await initSuperAdmin();
        } catch (error) {
          showMessage(error.message, 'danger');
          button.disabled = false;
        }
      });
    }
  }

  async function initOwner() {
    const data = await api('/api/owner/dashboard');
    $('#gym-title').textContent = data.gym.gym_name;
    $('#gym-subtitle').textContent = `${data.gym.location} · Manage your members, trainers, plans and day-to-day operations.`;
    $('#stats').innerHTML = [
      statCard('Members', data.stats.members, '♙'),
      statCard('Trainers', data.stats.trainers, '✦'),
      statCard('Member payments', formatMoney(data.stats.grossRevenue), '₹'),
      statCard('Trainer salaries paid', formatMoney(data.stats.trainerSalaryPaid), '−'),
      statCard('Net gym revenue', formatMoney(data.stats.revenue), '₹'),
      statCard('Pending approvals', data.stats.pendingApprovals, '◷')
    ].join('');

    const platformSubscription = data.platformSubscription || { current: null, availablePlans: [], history: [] };
    const currentPlatformSubscription = platformSubscription.current;
    $('#platform-subscription-status').textContent = currentPlatformSubscription ? 'Active' : 'No active plan';
    $('#platform-current-subscription').innerHTML = currentPlatformSubscription
      ? `<article class="request-card mb-0">
          <div class="request-card-heading"><div><strong>${escapeHtml(currentPlatformSubscription.plan_name)}</strong><p>${Number(currentPlatformSubscription.duration_months)} month(s) · ${formatMoney(currentPlatformSubscription.amount)}</p></div>${statusPill('Active')}</div>
          <p class="small text-secondary mb-1">Valid from ${formatDate(currentPlatformSubscription.start_date)} through ${formatDate(currentPlatformSubscription.end_date)}.</p>
          <p class="small text-secondary mb-0">Payment: ${escapeHtml(currentPlatformSubscription.payment_method)} · Reference: ${escapeHtml(currentPlatformSubscription.transaction_reference)}</p>
        </article>`
      : emptyState('You do not have an active FitTrack platform subscription. Choose one of the available plans below.');

    $('#platform-plan-list').innerHTML = platformSubscription.availablePlans.length
      ? platformSubscription.availablePlans.map((plan) => `<article class="workout-plan-card">
          <div class="plan-card-heading"><div><h3>${escapeHtml(plan.plan_name)}</h3><p>${Number(plan.duration_months)} month(s)</p></div><strong>${formatMoney(plan.price)}</strong></div>
          <p class="small text-secondary">${escapeHtml(plan.description || 'Platform subscription for your gym.')}</p>
          <button class="btn btn-primary btn-sm" type="button" data-owner-platform-plan="${plan.platform_plan_id}">Pay demo subscription</button>
        </article>`).join('')
      : emptyState('The Super Admin has not published any active platform subscription plans yet.');

    $('#platform-subscription-history').innerHTML = platformSubscription.history.length
      ? platformSubscription.history.map((item) => `<tr>
          <td>${escapeHtml(item.plan_name)}<div class="table-subtext">${Number(item.duration_months)} month(s)</div></td>
          <td>${formatMoney(item.amount)}</td>
          <td>${escapeHtml(item.payment_method)}</td>
          <td>${statusPill(item.subscription_status)}</td>
          <td>${formatDate(item.start_date)} – ${formatDate(item.end_date)}</td>
          <td>${escapeHtml(item.transaction_reference)}</td>
          <td>${formatDate(item.paid_at)}</td>
        </tr>`).join('')
      : renderRows([], 7);
    const now = new Date();
    const defaultSalaryMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const salaryMonthInput = $('#salary-month');
    if (salaryMonthInput) {
      salaryMonthInput.max = defaultSalaryMonth;
      if (!salaryMonthInput.value) salaryMonthInput.value = defaultSalaryMonth;
    }
    const selectedSalaryMonth = salaryMonthInput?.value || defaultSalaryMonth;
    $('#trainer-salary-table').innerHTML = data.trainers.length ? data.trainers.map((trainer) => {
      const paid = data.salaryPayments.find((item) => Number(item.train_id) === Number(trainer.train_id) && String(item.salary_month).slice(0, 7) === selectedSalaryMonth && item.payment_status === 'Paid');
      return `<tr>
        <td><strong>${escapeHtml(trainer.first_name)} ${escapeHtml(trainer.last_name)}</strong><div class="table-subtext">${escapeHtml(trainer.email || '')}</div></td>
        <td>${formatMoney(trainer.base_salary)}</td>
        <td>${paid ? statusPill('Paid') : statusPill('Due')}</td>
        <td>${paid ? `${formatMoney(paid.amount_paid)} · ${formatDate(paid.pay_date)}` : `<button class="btn btn-sm btn-primary" type="button" data-pay-trainer-salary="${trainer.train_id}" ${Number(trainer.base_salary) <= 0 ? 'disabled' : ''}>Pay salary</button>`}</td>
      </tr>`;
    }).join('') : renderRows([], 4);
    $('#trainer-salary-history').innerHTML = data.salaryPayments.length ? data.salaryPayments.map((item) => `
      <tr><td>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</td><td>${String(item.salary_month).slice(0, 7)}</td><td>${formatMoney(item.amount_paid)}</td><td>${escapeHtml(item.pay_method)}</td><td>${statusPill(item.payment_status)}</td><td>${formatDate(item.pay_date)}</td><td>${escapeHtml(item.transaction_reference)}</td></tr>
    `).join('') : renderRows([], 7);

    $('#pending-count').textContent = data.pendingUsers.length;
    $('#pending-users').innerHTML = data.pendingUsers.length ? data.pendingUsers.map((person) => `
      <article class="approval-card"><div class="approval-main"><div class="avatar-circle">${escapeHtml((person.first_name || person.username).slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}</strong><p>${escapeHtml(person.username)} · ${escapeHtml(person.profile_email)}</p><small>${escapeHtml(person.role === 'Members' ? 'Member' : 'Trainer')} · Account #${person.user_id}</small></div></div>
      <div class="approval-actions"><button class="btn btn-sm btn-primary" data-owner-action="approve" data-user-id="${person.user_id}">Approve</button><button class="btn btn-sm btn-outline-danger" data-owner-action="reject" data-user-id="${person.user_id}">Reject</button></div></article>`).join('') : emptyState('No members or trainers are waiting for approval.');
    $('#plans-list').innerHTML = data.plans.length ? data.plans.map((plan) => `<div class="compact-item"><div><strong>${escapeHtml(plan.plan_name)}</strong><small>${plan.plan_duration} month(s)</small></div><b>${formatMoney(plan.price)}</b></div>`).join('') : emptyState('No membership plans created yet.');
    $('#videos-list').innerHTML = data.videos.length ? data.videos.map((video) => `<div class="compact-item"><div><strong>${escapeHtml(video.workout_name)}</strong><small>${escapeHtml(video.target_muscle_group || 'General')}</small></div><a class="small" href="${escapeHtml(safeUrl(video.video_url))}" target="_blank" rel="noopener noreferrer">Open video ↗</a></div>`).join('') : emptyState('No workout videos added yet.');
    $('#payments-table').innerHTML = data.payments.length ? data.payments.map((payment) => `<tr><td>${escapeHtml(payment.first_name)} ${escapeHtml(payment.last_name)}</td><td>${escapeHtml(payment.plan_name)}</td><td>${formatMoney(payment.amount)}</td><td>${escapeHtml(payment.pay_method)}</td><td>${statusPill(payment.pay_status)}</td><td>${formatDate(payment.pay_date)}</td></tr>`).join('') : renderRows([], 6);
    $('#attendance-table').innerHTML = data.attendance.length ? data.attendance.map((row) => `<tr><td>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</td><td>${formatDate(row.date)}</td><td>${formatTime(row.check_in)}</td><td>${formatTime(row.check_out)}</td></tr>`).join('') : renderRows([], 4);

    if (salaryMonthInput && !salaryMonthInput.dataset.bound) {
      salaryMonthInput.dataset.bound = 'true';
      salaryMonthInput.addEventListener('change', () => initOwner().catch((error) => showMessage(error.message, 'danger')));
    }
    if (!$('#trainer-salary-table').dataset.bound) {
      $('#trainer-salary-table').dataset.bound = 'true';
      $('#trainer-salary-table').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-pay-trainer-salary]');
        if (!button) return;
        const month = $('#salary-month').value;
        const method = $('#salary-payment-method').value;
        if (!month) return showMessage('Choose the salary month first.', 'warning');
        if (!window.confirm(`Record the trainer's base salary payment for ${month}? The amount is read from the salary saved in the trainer profile.`)) return;
        button.disabled = true;
        try {
          const result = await api(`/api/owner/trainers/${button.dataset.payTrainerSalary}/salary`, {
            method: 'POST', body: { salary_month: month, payment_method: method }
          });
          showMessage(result.message);
          await initOwner();
        } catch (error) {
          showMessage(error.message, 'danger');
          button.disabled = false;
        }
      });
    }

    if (!$('#platform-plan-list').dataset.bound) {
      $('#platform-plan-list').dataset.bound = 'true';
      $('#platform-plan-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-owner-platform-plan]');
        if (!button) return;
        const planId = Number(button.dataset.ownerPlatformPlan);
        const method = $('#platform-payment-method').value;
        if (!window.confirm('This is a demo checkout. It will record a test payment only; no real money will be transferred. Continue?')) return;
        button.disabled = true;
        try {
          const result = await api('/api/owner/platform-subscriptions', {
            method: 'POST',
            body: { platform_plan_id: planId, payment_method: method }
          });
          showMessage(`${result.message} Reference: ${result.transaction_reference}`);
          await initOwner();
        } catch (error) {
          showMessage(error.message, 'danger');
          button.disabled = false;
        }
      });
    }

    if (!$('#pending-users').dataset.bound) {
      $('#pending-users').dataset.bound = 'true';
      $('#pending-users').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-owner-action]');
      if (!button) return;
      button.disabled = true;
      try {
        const result = await api(`/api/owner/users/${button.dataset.userId}/${button.dataset.ownerAction}`, { method: 'PATCH' });
        showMessage(result.message);
        await initOwner();
      } catch (error) { showMessage(error.message, 'danger'); button.disabled = false; }
      });
    }

    if (!$('#create-plan-form').dataset.bound) {
      $('#create-plan-form').dataset.bound = 'true';
      $('#create-plan-form').addEventListener('submit', async (event) => {
      event.preventDefault(); clearMessage();
      const form = event.currentTarget;
      try {
        const result = await api('/api/owner/plans', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
        showMessage(result.message); form.reset(); await initOwner();
      } catch (error) { showMessage(error.message, 'danger'); }
      });
    }
    if (!$('#create-video-form').dataset.bound) {
      $('#create-video-form').dataset.bound = 'true';
      $('#create-video-form').addEventListener('submit', async (event) => {
      event.preventDefault(); clearMessage();
      const form = event.currentTarget;
      try {
        const result = await api('/api/owner/videos', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
        showMessage(result.message); form.reset(); await initOwner();
      } catch (error) { showMessage(error.message, 'danger'); }
      });
    }
  }

  function exerciseRow(videos) {
    const options = videos.map((video) => `<option value="${video.video_id}">${escapeHtml(video.workout_name)}${video.target_muscle_group ? ` — ${escapeHtml(video.target_muscle_group)}` : ''}</option>`).join('');
    return `<div class="exercise-row"><div><label class="form-label">Video</label><select class="form-select" name="video_id" required><option value="">Choose video</option>${options}</select></div><div><label class="form-label">Section</label><input class="form-control" name="workout_section" value="Main workout" required maxlength="100"></div><div><label class="form-label">Sets</label><input class="form-control" name="sets" type="number" min="1" max="100" value="3" required></div><div><label class="form-label">Reps</label><input class="form-control" name="reps" value="10" maxlength="100" required></div><button class="btn btn-light btn-sm remove-exercise" type="button" aria-label="Remove exercise">×</button></div>`;
  }

  async function initTrainer() {
    const data = await api('/api/trainer/dashboard');
    const attendance = data.attendance;
    if (attendance) {
      $('#attendance-status').textContent = attendance.check_out ? 'Shift completed' : 'You are clocked in';
      $('#attendance-times').textContent = `Check-in: ${formatTime(attendance.check_in)} · Check-out: ${formatTime(attendance.check_out)}`;
      $('#clock-in-button').disabled = true;
      $('#clock-out-button').disabled = Boolean(attendance.check_out);
    }

    $('#requests-count').textContent = data.requests.filter((request) => ['Pending', 'Accepted'].includes(request.status)).length;
    $('#workout-requests').innerHTML = data.requests.length ? data.requests.map((request) => {
      const completedPlan = request.status === 'Completed';
      const requestIsPending = request.status === 'Pending';
      const requestIsAccepted = request.status === 'Accepted';
      return `<article class="request-card">
        <div class="request-card-heading"><div><strong>${escapeHtml(request.first_name)} ${escapeHtml(request.last_name)}</strong><p>${escapeHtml(request.email)} · Requested ${formatDate(request.request_date)}</p></div>${statusPill(request.status)}</div>
        <p class="request-notes">${escapeHtml(request.member_notes || 'No additional notes provided.')}</p>
        ${requestIsPending ? `<div class="request-actions"><button class="btn btn-sm btn-outline-primary" data-request-status="Accepted" data-request-id="${request.request_id}">Accept request</button><button class="btn btn-sm btn-outline-danger" data-request-status="Rejected" data-request-id="${request.request_id}">Reject</button></div>` : ''}
        ${requestIsAccepted ? `<div class="request-actions"><button class="btn btn-sm btn-primary" data-toggle-plan="${request.request_id}">Create and send workout plan</button></div>
        <form class="plan-builder" data-plan-form="${request.request_id}" hidden>
          <div><label class="form-label">Plan title</label><input class="form-control" name="plan_title" required maxlength="150" placeholder="Beginner strength plan"></div>
          <div class="exercise-list">${data.videos.length ? exerciseRow(data.videos) : '<p class="text-danger small">Ask the gym owner to add workout videos before assigning a plan.</p>'}</div>
          ${data.videos.length ? `<div class="builder-footer"><button class="btn btn-sm btn-outline-secondary" type="button" data-add-exercise="${request.request_id}">+ Add exercise</button><button class="btn btn-sm btn-primary" type="submit">Assign and send to member</button></div>` : ''}
        </form>` : ''}
        ${completedPlan ? `<p class="small text-success mb-0">Plan sent to member: ${escapeHtml(request.plan_title || 'Workout plan')}</p>` : ''}
      </article>`;
    }).join('') : emptyState('No workout requests yet.');

    $('#assigned-members').innerHTML = data.members.length ? data.members.map((member) => `<div class="compact-item"><div><strong>${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</strong><small>${escapeHtml(member.email || member.phone || 'Member')}</small></div><span class="status-pill status-success">Assigned</span></div>`).join('') : emptyState('Members will appear here after they request a plan.');
    $('#assigned-plans').innerHTML = data.assignedPlans.length ? data.assignedPlans.map((plan) => `<div class="compact-item"><div><strong>${escapeHtml(plan.plan_title)}</strong><small>${escapeHtml(plan.first_name)} ${escapeHtml(plan.last_name)} · ${formatDate(plan.assigned_date)}</small></div><span class="text-secondary small">#${plan.plan_id}</span></div>`).join('') : emptyState('You have not assigned any workout plans yet.');

    if (!$('#clock-in-button').dataset.bound) {
      $('#clock-in-button').dataset.bound = 'true';
      $('#clock-in-button').addEventListener('click', async () => {
      try { const result = await api('/api/trainer/attendance/clock-in', { method: 'POST', body: {} }); showMessage(result.message); await initTrainer(); }
      catch (error) { showMessage(error.message, 'danger'); }
      });
    }
    if (!$('#clock-out-button').dataset.bound) {
      $('#clock-out-button').dataset.bound = 'true';
      $('#clock-out-button').addEventListener('click', async () => {
      try { const result = await api('/api/trainer/attendance/clock-out', { method: 'POST', body: {} }); showMessage(result.message); await initTrainer(); }
      catch (error) { showMessage(error.message, 'danger'); }
      });
    }
    if (!$('#workout-requests').dataset.bound) {
      $('#workout-requests').dataset.bound = 'true';
      $('#workout-requests').addEventListener('click', async (event) => {
      const statusButton = event.target.closest('[data-request-status]');
      if (statusButton) {
        statusButton.disabled = true;
        try {
          const result = await api(`/api/trainer/requests/${statusButton.dataset.requestId}/status`, { method: 'PATCH', body: { status: statusButton.dataset.requestStatus } });
          showMessage(result.message); await initTrainer();
        } catch (error) { showMessage(error.message, 'danger'); statusButton.disabled = false; }
        return;
      }
      const toggleButton = event.target.closest('[data-toggle-plan]');
      if (toggleButton) {
        const form = $(`[data-plan-form="${toggleButton.dataset.togglePlan}"]`, $('#workout-requests'));
        if (form) form.hidden = !form.hidden;
        return;
      }
      const addButton = event.target.closest('[data-add-exercise]');
      if (addButton) {
        const form = $(`[data-plan-form="${addButton.dataset.addExercise}"]`, $('#workout-requests'));
        const rows = $$('.exercise-row', form);
        if (rows.length >= 30) return showMessage('A workout plan can contain at most 30 exercises.', 'warning');
        $('.exercise-list', form).insertAdjacentHTML('beforeend', exerciseRow(data.videos));
        return;
      }
      const removeButton = event.target.closest('.remove-exercise');
      if (removeButton) {
        const list = removeButton.closest('.exercise-list');
        if ($$('.exercise-row', list).length > 1) removeButton.closest('.exercise-row').remove();
      }
      });
      $('#workout-requests').addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-plan-form]');
      if (!form) return;
      event.preventDefault();
      const exercises = $$('.exercise-row', form).map((row) => ({
        video_id: $('select[name="video_id"]', row).value,
        workout_section: $('input[name="workout_section"]', row).value,
        sets: $('input[name="sets"]', row).value,
        reps: $('input[name="reps"]', row).value
      }));
      try {
        const result = await api(`/api/trainer/requests/${form.dataset.planForm}/plans`, {
          method: 'POST', body: { plan_title: $('input[name="plan_title"]', form).value, exercises }
        });
        showMessage(result.message); await initTrainer();
      } catch (error) { showMessage(error.message, 'danger'); }
      });
    }
  }

  async function initMember() {
    const data = await api('/api/member/dashboard');
    $('#member-title').textContent = `Welcome, ${data.member.first_name}`;
    $('#member-profile').innerHTML = `
      <div class="profile-name">${escapeHtml(data.member.first_name)} ${escapeHtml(data.member.last_name)}</div>
      <dl class="profile-list"><div><dt>Email</dt><dd>${escapeHtml(data.member.email || '—')}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(data.member.phone || '—')}</dd></div><div><dt>Date of birth</dt><dd>${formatDate(data.member.dob)}</dd></div><div><dt>Address</dt><dd>${escapeHtml(data.member.address || '—')}</dd></div><div><dt>Medical notes</dt><dd>${escapeHtml(data.member.medical_cond || 'None provided')}</dd></div></dl>`;
    $('#subscription-plan').innerHTML = '<option value="">Choose a membership plan</option>' + data.plans.map((plan) => `<option value="${plan.plan_id}">${escapeHtml(plan.plan_name)} — ${plan.plan_duration} month(s) — ${formatMoney(plan.price)}</option>`).join('');
    if (!data.plans.length) $('#subscription-plan').innerHTML = '<option value="">No plans have been added by your gym yet</option>';
    $('#subscriptions-list').innerHTML = data.subscriptions.length ? data.subscriptions.map((subscription) => `<div class="compact-item"><div><strong>${escapeHtml(subscription.plan_name)}</strong><small>${formatDate(subscription.start_date)} – ${formatDate(subscription.end_date)}</small></div>${statusPill(subscription.subscription_status)}</div>`).join('') : emptyState('No membership subscription found.');
    $('#trainer-select').innerHTML = '<option value="">Choose a trainer</option>' + data.trainers.map((trainer) => `<option value="${trainer.train_id}">${escapeHtml(trainer.first_name)} ${escapeHtml(trainer.last_name)}${trainer.exp_years ? ` · ${trainer.exp_years} yrs experience` : ''}</option>`).join('');
    if (!data.trainers.length) $('#trainer-select').innerHTML = '<option value="">No approved trainers available</option>';
    $('#member-requests').innerHTML = data.requests.length ? data.requests.map((request) => `<div class="compact-item"><div><strong>${escapeHtml(request.trainer_first_name)} ${escapeHtml(request.trainer_last_name)}</strong><small>${escapeHtml(request.member_notes || 'Workout plan request')} · ${formatDate(request.request_date)}</small></div>${statusPill(request.status)}</div>`).join('') : emptyState('No workout requests submitted.');
    $('#member-workout-plans').innerHTML = data.workoutPlans.length ? data.workoutPlans.map((plan) => `<article class="workout-plan-card"><div class="plan-card-heading"><div><h3>${escapeHtml(plan.plan_title)}</h3><p>Assigned ${formatDate(plan.assigned_date)}</p></div><span class="count-pill">${plan.exercises.length} exercises</span></div><div class="exercise-table">${plan.exercises.map((exercise) => `<div class="exercise-item"><div><strong>${escapeHtml(exercise.workout_name)}</strong><small>${escapeHtml(exercise.workout_section)} · ${escapeHtml(exercise.target_muscle_group || 'General')}</small></div><span>${exercise.sets} sets × ${escapeHtml(exercise.reps)}</span><a href="${escapeHtml(safeUrl(exercise.video_url))}" target="_blank" rel="noopener noreferrer">Watch ↗</a></div>`).join('')}</div></article>`).join('') : emptyState('Your assigned workout plans will appear here.');
    $('#member-payments').innerHTML = data.payments.length ? data.payments.map((payment) => `<tr><td>#${payment.payment_id}</td><td>${formatMoney(payment.amount)}</td><td>${escapeHtml(payment.pay_method)}</td><td>${statusPill(payment.pay_status)}</td><td>${formatDate(payment.pay_date)}</td></tr>`).join('') : renderRows([], 5);

    if (!$('#subscription-form').dataset.bound) {
      $('#subscription-form').dataset.bound = 'true';
      $('#subscription-form').addEventListener('submit', async (event) => {
      event.preventDefault(); clearMessage();
      try {
        const result = await api('/api/member/subscriptions', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
        showMessage(result.message); event.currentTarget.reset(); await initMember();
      } catch (error) { showMessage(error.message, 'danger'); }
      });
    }
    if (!$('#workout-request-form').dataset.bound) {
      $('#workout-request-form').dataset.bound = 'true';
      $('#workout-request-form').addEventListener('submit', async (event) => {
      event.preventDefault(); clearMessage();
      try {
        const result = await api('/api/member/workout-requests', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
        showMessage(result.message); event.currentTarget.reset(); await initMember();
      } catch (error) { showMessage(error.message, 'danger'); }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.dataset.page;
    try {
      if (page === 'login') return initLogin();
      if (page === 'register') return initRegister();
      await confirmCurrentUser();
      if (page === 'superadmin') await initSuperAdmin();
      if (page === 'owner') await initOwner();
      if (page === 'trainer') await initTrainer();
      if (page === 'member') await initMember();
    } catch (error) {
      showMessage(error.message, 'danger');
      console.error(error);
    }
  });
})();
