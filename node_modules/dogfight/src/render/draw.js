export function drawEntity(ctx, entity) {
  ctx.save();
  ctx.translate(entity.pos.x, entity.pos.y);

  if (entity.kind === 'ship') {
    ctx.rotate(entity.angle);
    ctx.strokeStyle = '#00ffff';
    ctx.fillStyle = '#0b0f19';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (entity.isThrusting) {
      ctx.strokeStyle = '#ffaa00';
      ctx.beginPath();
      ctx.moveTo(-8, -5);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-8, 5);
      ctx.stroke();
    }
  } else if (entity.kind === 'bullet') {
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (entity.kind === 'asteroid') {
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
    ctx.stroke();
  } else if (entity.kind === 'pickup') {
    ctx.fillStyle = '#00ff66';
    ctx.beginPath();
    ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawHud(ctx, stats, score, hp) {
  ctx.save();
  ctx.fillStyle = '#00ffcc';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  
  const x = 30;
  let y = 30;
  
  ctx.fillText(`steps/s: ${Math.round(stats.stepsPerSecond || 60)}`, x, y);
  y += 20;
  ctx.fillText(`frames/s: ${Math.round(stats.fps || 60)}`, x, y);
  y += 20;
  ctx.fillText(`Score: ${score}`, x, y);
  y += 20;
  ctx.fillText(`Ship HP: ${hp}`, x, y);
  
  ctx.restore();
}