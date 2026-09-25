document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'theme-toggle';
  toggleBtn.innerHTML = '🌓';
  toggleBtn.title = 'Dark/Light Mode wechseln (Taste: T)';
  toggleBtn.setAttribute('aria-label', 'Theme wechseln');
  toggleBtn.tabIndex = 0; // Macht den Button fokussierbar
  document.body.appendChild(toggleBtn);

  // Mouseover für den ganzen rechten Bereich
  const rightEdge = document.createElement('div');
  rightEdge.style.position = 'fixed';
  rightEdge.style.right = '0';
  rightEdge.style.top = '0';
  rightEdge.style.width = '50px';
  rightEdge.style.height = '100vh';
  rightEdge.style.zIndex = '999';
  document.body.appendChild(rightEdge);

  let showTimeout;
  rightEdge.addEventListener('mouseenter', () => {
    clearTimeout(showTimeout);
    toggleBtn.style.opacity = '1';
  });

  rightEdge.addEventListener('mouseleave', () => {
    // Nur ausblenden wenn nicht fokussiert
    if (!toggleBtn.matches(':focus')) {
      showTimeout = setTimeout(() => {
        toggleBtn.style.opacity = '0';
      }, 1000);
    }
  });

  // Toggle-Funktion
  const toggleTheme = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
  };

  // Klick-Event
  toggleBtn.addEventListener('click', toggleTheme);

  // Beim Laden prüfen
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
  }
});
