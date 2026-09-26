document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-quiz-target]');
  if (!button) return;

  const feedback = document.getElementById(button.dataset.quizTarget);
  if (!feedback) return;

  const correct = button.dataset.correct === 'true';
  feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
  feedback.textContent = button.dataset.feedback;
});
