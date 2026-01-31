// Shapi&CO - Firebase Version
const FIREBASE_CONFIG = {
    databaseURL: "https://shapi-co-clinic-default-rtdb.europe-west1.firebasedatabase.app/"
};


firebase.initializeApp(FIREBASE_CONFIG);
const database = firebase.database();


const DEFAULT_USERS = {
    'admin': { password: 'admin', role: 'admin', name: 'Администратор', color: '#1e3a8a' },
    'doctor1': { password: 'doctor1', role: 'doctor', name: 'Врач 1', color: '#2563eb' },
    'doctor2': { password: 'doctor2', role: 'doctor', name: 'Врач 2', color: '#10b981' },
    'doctor3': { password: 'doctor3', role: 'doctor', name: 'Врач 3', color: '#f59e0b' },
    'doctor4': { password: 'doctor4', role: 'doctor', name: 'Врач 4', color: '#8b5cf6' },
    'doctor5': { password: 'doctor5', role: 'doctor', name: 'Врач 5', color: '#ec4899' }
};


let currentUser = null;
let calendar = null;
let appointments = [];
let patients = [];
let doctors = {};
let uploadedFiles = [];
let currentFilter = 'all';
let appointmentsRef = null;
let patientsRef = null;
let doctorsRef = null;


const ROOM_COLORS = {
    '1': '#2563eb',
    '2': '#10b981', 
    '3': '#f59e0b'
};


document.addEventListener('DOMContentLoaded', () => {
    initApp();
});


function initApp() {
    appointmentsRef = database.ref('appointments');
    patientsRef = database.ref('patients');
    doctorsRef = database.ref('doctors');
    
    doctorsRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
            doctorsRef.set(DEFAULT_USERS);
        }
    });
    
    appointmentsRef.on('value', (snapshot) => {
        appointments = [];
        snapshot.forEach((child) => {
            appointments.push({ id: child.key, ...child.val() });
        });
        if (calendar) calendar.refetchEvents();
        updatePatientsList();
    });
    
    patientsRef.on('value', (snapshot) => {
        patients = [];
        snapshot.forEach((child) => {
            patients.push({ id: child.key, ...child.val() });
        });
        updatePatientsList();
    });
    
    doctorsRef.on('value', (snapshot) => {
        doctors = snapshot.val() || DEFAULT_USERS;
        if (currentUser?.role === 'admin') {
            renderDoctorsList();
        }
    });
    
    checkAuth();
    setupEventListeners();
    setupPhoneMask();
}


function checkAuth() {
    const savedUser = localStorage.getItem('shapiCoUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    } else {
        showLogin();
    }
}


function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}


function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    
    document.getElementById('currentUserName').textContent = currentUser.name;
    document.getElementById('currentUserRole').textContent = 
        currentUser.role === 'admin' ? 'Администратор' : currentUser.name;
    
    if (currentUser.role === 'admin') {
        document.getElementById('adminPanel').style.display = 'block';
        renderDoctorsList();
    }
    
    initCalendar();
    updatePatientsList();
}


document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    const doctorsSnapshot = await doctorsRef.once('value');
    const doctorsData = doctorsSnapshot.val() || DEFAULT_USERS;
    
    const user = doctorsData[username];
    
    if (user && user.password === password) {
        currentUser = {
            username: username,
            name: user.name,
            role: user.role,
            color: user.color
        };
        
        localStorage.setItem('shapiCoUser', JSON.stringify(currentUser));
        showApp();
        showToast(`Добро пожаловать, ${user.name}!`, 'success');
    } else {
        showToast('Неверный логин или пароль!', 'error');
    }
});


function logout() {
    localStorage.removeItem('shapiCoUser');
    currentUser = null;
    showLogin();
}


function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        locale: 'ru',
        initialView: 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        slotDuration: '00:30:00',
        slotMinTime: '08:00',
        slotMaxTime: '20:00',
        allDaySlot: false,
        weekends: true,
        height: 'auto',
        selectable: true,
        
        businessHours: {
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            startTime: '08:00',
            endTime: '20:00',
        },
        
        events: (fetchInfo, successCallback) => {
            let filtered = appointments;
            
            if (currentFilter === 'my' && currentUser.role !== 'admin') {
                filtered = appointments.filter(a => a.createdBy === currentUser.username);
            }
            
            const roomFilter = document.querySelector('.filter-btn[data-room].active');
            if (roomFilter) {
                filtered = filtered.filter(a => a.room === roomFilter.dataset.room);
            }
            
            const events = filtered.map(apt => ({
                id: apt.id,
                title: `${apt.lastName} ${apt.firstName}`,
                start: apt.dateTime,
                end: calculateEndTime(apt.dateTime),
                backgroundColor: ROOM_COLORS[apt.room],
                borderColor: ROOM_COLORS[apt.room],
                extendedProps: apt
            }));
            
            successCallback(events);
        },
        
        select: (info) => {
            openModal(null, info.start);
        },
        
        eventClick: (info) => {
            openModal(info.event.extendedProps);
        }
    });
    
    calendar.render();
}


function calculateEndTime(startTime) {
    const date = new Date(startTime);
    date.setMinutes(date.getMinutes() + 30);
    return date.toISOString();
}


function openModal(appointment = null, selectedDate = null) {
    const modal = document.getElementById('modalOverlay');
    const form = document.getElementById('appointmentForm');
    const deleteBtn = document.getElementById('deleteBtn');
    
    form.reset();
    uploadedFiles = [];
    updatePreviewGrid();
    
    if (appointment) {
        if (!canEditAppointment(appointment)) {
            showToast('Нет прав для редактирования этой записи', 'error');
            return;
        }
        
        document.getElementById('modalTitle').textContent = 'Редактирование записи';
        document.getElementById('appointmentId').value = appointment.id;
        document.getElementById('lastName').value = appointment.lastName;
        document.getElementById('firstName').value = appointment.firstName;
        document.getElementById('middleName').value = appointment.middleName || '';
        document.getElementById('phone').value = appointment.phone;
        document.getElementById('dateTime').value = formatDateTimeLocal(appointment.dateTime);
        document.getElementById('room').value = appointment.room;
        document.getElementById('comment').value = appointment.comment || '';
        
        if (appointment.files) {
            uploadedFiles = [...appointment.files];
            updatePreviewGrid();
        }
        
        deleteBtn.style.display = 'inline-block';
    } else {
        document.getElementById('modalTitle').textContent = 'Новая запись';
        document.getElementById('appointmentId').value = '';
        
        if (selectedDate) {
            document.getElementById('dateTime').value = formatDateTimeLocal(selectedDate);
        } else {
            const now = new Date();
            now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30);
            document.getElementById('dateTime').value = formatDateTimeLocal(now);
        }
        
        deleteBtn.style.display = 'none';
    }
    
    modal.style.display = 'flex';
}


function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}


function canEditAppointment(appointment) {
    if (currentUser.role === 'admin') return true;
    return appointment.createdBy === currentUser.username;
}


function formatDateTimeLocal(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}


function handleFiles(files) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedFiles.push({
                name: file.name,
                type: file.type,
                data: e.target.result,
                id: Date.now() + Math.random()
            });
            updatePreviewGrid();
        };
        reader.readAsDataURL(file);
    });
}


function updatePreviewGrid() {
    const grid = document.getElementById('previewGrid');
    grid.innerHTML = uploadedFiles.map((file, index) => `
        <div class="preview-item">
            ${file.type.startsWith('image/') 
                ? `<img src="${file.data}" alt="${file.name}">`
                : `<div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f3f4f6;">
                     <i class="fas fa-file-pdf" style="font-size: 2rem; color: #ef4444;"></i>
                   </div>`
            }
            <button class="remove" onclick="removeFile(${index})">&times;</button>
        </div>
    `).join('');
}


function removeFile(index) {
    uploadedFiles.splice(index, 1);
    updatePreviewGrid();
}


async function saveAppointment() {
    const id = document.getElementById('appointmentId').value;
    const lastName = document.getElementById('lastName').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const dateTime = document.getElementById('dateTime').value;
    const room = document.getElementById('room').value;
    
    if (!lastName || !firstName || !phone || !dateTime) {
        showToast('Заполните обязательные поля', 'error');
        return;
    }
    
    const isOverlap = checkOverlap(dateTime, room, id);
    if (isOverlap) {
        showToast('Это время уже занято в выбранном кабинете', 'error');
        return;
    }
    
    showSyncStatus(true);
    
    const appointmentData = {
        lastName,
        firstName,
        middleName: document.getElementById('middleName').value.trim(),
        phone,
        dateTime,
        room,
        comment: document.getElementById('comment').value.trim(),
        files: uploadedFiles,
        createdBy: currentUser.username,
        doctorName: currentUser.name,
        doctorColor: currentUser.color,
        createdAt: new Date().toISOString()
    };
    
    try {
        if (id) {
            await appointmentsRef.child(id).update(appointmentData);
        } else {
            await appointmentsRef.push(appointmentData);
        }
        
        await updatePatientBase(appointmentData);
        
        closeModal();
        showToast('Запись сохранена', 'success');
    } catch (error) {
        console.error('Error:', error);
        showToast('Ошибка сохранения', 'error');
    } finally {
        showSyncStatus(false);
    }
}


function checkOverlap(dateTime, room, excludeId) {
    const newStart = new Date(dateTime);
    const newEnd = new Date(newStart.getTime() + 30 * 60000);
    
    return appointments.some(apt => {
        if (apt.id === excludeId) return false;
        if (apt.room !== room) return false;
        
        const aptStart = new Date(apt.dateTime);
        const aptEnd = new Date(aptStart.getTime() + 30 * 60000);
        
        return (newStart < aptEnd && newEnd > aptStart);
    });
}


async function updatePatientBase(appointment) {
    const existingPatient = patients.find(p => p.phone === appointment.phone);
    
    if (existingPatient) {
        await patientsRef.child(existingPatient.id).update({
            lastName: appointment.lastName,
            firstName: appointment.firstName,
            middleName: appointment.middleName,
            lastVisit: appointment.dateTime
        });
    } else {
        await patientsRef.push({
            lastName: appointment.lastName,
            firstName: appointment.firstName,
            middleName: appointment.middleName,
            phone: appointment.phone,
            firstVisit: appointment.dateTime,
            lastVisit: appointment.dateTime
        });
    }
}


async function deleteAppointment() {
    const id = document.getElementById('appointmentId').value;
    if (!id) return;
    
    if (!confirm('Удалить запись?')) return;
    
    showSyncStatus(true);
    
    try {
        await appointmentsRef.child(id).remove();
        closeModal();
        showToast('Запись удалена', 'success');
    } catch (error) {
        showToast('Ошибка удаления', 'error');
    } finally {
        showSyncStatus(false);
    }
}


async function addDoctor() {
    const name = document.getElementById('newDoctorName').value.trim();
    const login = document.getElementById('newDoctorLogin').value.trim();
    const password = document.getElementById('newDoctorPassword').value.trim();
    
    if (!name || !login || !password) {
        showToast('Заполните все поля', 'error');
        return;
    }
    
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    try {
        await doctorsRef.child(login).set({
            name: name,
            password: password,
            role: 'doctor',
            color: randomColor
        });
        
        document.getElementById('newDoctorName').value = '';
        document.getElementById('newDoctorLogin').value = '';
        document.getElementById('newDoctorPassword').value = '';
        
        showToast('Врач добавлен', 'success');
    } catch (error) {
        showToast('Ошибка добавления врача', 'error');
    }
}


function renderDoctorsList() {
    const container = document.getElementById('doctorsList');
    
    if (!doctors || Object.keys(doctors).length === 0) {
        container.innerHTML = '<p>Врачи не найдены</p>';
        return;
    }
    
    container.innerHTML = Object.entries(doctors).map(([login, doctor]) => `
        <div class="doctor-item">
            <div>
                <strong>${doctor.name}</strong> 
                <span style="color: ${doctor.color}; font-size: 1.2rem;">●</span>
                <br>
                <small>Логин: ${login} | Роль: ${doctor.role === 'admin' ? 'Админ' : 'Врач'}</small>
            </div>
            ${login !== 'admin' ? `<button class="btn-danger" onclick="deleteDoctor('${login}')" style="padding: 0.5rem 1rem;">Удалить</button>` : ''}
        </div>
    `).join('');
}


async function deleteDoctor(login) {
    if (!confirm('Удалить врача?')) return;
    
    try {
        await doctorsRef.child(login).remove();
        showToast('Врач удалён', 'success');
    } catch (error) {
        showToast('Ошибка удаления', 'error');
    }
}


function updatePatientsList() {
    const grid = document.getElementById('patientsGrid');
    const search = document.getElementById('patientSearch')?.value || '';
    
    let filtered = patients;
    if (search) {
        const lower = search.toLowerCase();
        filtered = patients.filter(p => 
            p.lastName?.toLowerCase().includes(lower) ||
            p.firstName?.toLowerCase().includes(lower) ||
            p.phone?.includes(search)
        );
    }
    
    filtered.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
    
    grid.innerHTML = filtered.map(p => {
        const lastApt = appointments
            .filter(a => a.phone === p.phone)
            .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];
        
        return `
        <div class="patient-card" onclick="showPatientHistory('${p.phone}')">
            <div class="patient-name">${p.lastName || ''} ${p.firstName || ''} ${p.middleName || ''}</div>
            <div class="patient-info"><i class="fas fa-phone"></i> ${p.phone || ''}</div>
            ${lastApt ? `
                <div class="patient-info">
                    <i class="fas fa-calendar"></i> ${new Date(lastApt.dateTime).toLocaleDateString('ru')}
                    <span class="patient-doctor" style="background: ${lastApt.doctorColor || '#666'}">
                        ${lastApt.doctorName || 'Неизвестно'}
                    </span>
                </div>
            ` : '<div class="patient-info">Нет записей</div>'}
        </div>
    `}).join('');
}


function showPatientHistory(phone) {
    const patientAppointments = appointments
        .filter(a => a.phone === phone)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    
    if (patientAppointments.length === 0) return;
    
    const patient = patients.find(p => p.phone === phone);
    const historyHtml = patientAppointments.map(apt => `
        <div style="padding: 1rem; border-bottom: 1px solid #e2e8f0;">
            <div style="font-weight: 600;">${new Date(apt.dateTime).toLocaleString('ru')}</div>
            <div>Кабинет ${apt.room}</div>
            <div style="margin-top: 0.5rem;">
                <span class="patient-doctor" style="background: ${apt.doctorColor || '#666'}">
                    ${apt.doctorName || 'Неизвестно'}
                </span>
            </div>
            ${apt.comment ? `<div style="color: #64748b; margin-top: 0.5rem;">${apt.comment}</div>` : ''}
            ${apt.files?.length ? `<div style="margin-top: 0.5rem;"><i class="fas fa-paperclip"></i> ${apt.files.length} файл(ов)</div>` : ''}
        </div>
    `).join('');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal" style="max-width: 700px;">
            <div class="modal-header">
                <h2>История: ${patient?.lastName || ''} ${patient?.firstName || ''}</h2>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                ${historyHtml}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}


function setupEventListeners() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            const room = btn.dataset.room;
            
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (filter) {
                currentFilter = filter;
            }
            
            if (calendar) calendar.refetchEvents();
        });
    });
    
    const fileUpload = document.querySelector('.file-upload');
    fileUpload?.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUpload.style.borderColor = '#3b82f6';
    });
    fileUpload?.addEventListener('dragleave', () => {
        fileUpload.style.borderColor = '#e2e8f0';
    });
    fileUpload?.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUpload.style.borderColor = '#e2e8f0';
        handleFiles(e.dataTransfer.files);
    });
    
    document.getElementById('patientSearch')?.addEventListener('input', updatePatientsList);
}


function setupPhoneMask() {
    const phoneInput = document.getElementById('phone');
    phoneInput?.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.startsWith('7') || value.startsWith('8')) {
            value = value.substring(1);
        }
        
        let formatted = '+7';
        if (value.length > 0) formatted += ' (' + value.substring(0, 3);
        if (value.length >= 3) formatted += ') ' + value.substring(3, 6);
        if (value.length >= 6) formatted += '-' + value.substring(6, 8);
        if (value.length >= 8) formatted += '-' + value.substring(8, 10);
        
        e.target.value = formatted;
    });
}


function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


function showSyncStatus(show) {
    const status = document.getElementById('syncStatus');
    if (show) {
        status.classList.add('active');
    } else {
        status.classList.remove('active');
    }
}