# Tracker de Rachas

App personal de un solo archivo para registrar hábitos diarios: el usuario define
hábitos buenos o malos y marca cada día si lo cumplió o no. Los datos viven en el
navegador (localStorage) con respaldo manual exportable.

## Language

**Hábito**: práctica que el usuario se compromete a hacer (bueno) o a evitar (malo),
identificada por su nombre normalizado y con una etiqueta por día.
_Avoid_: práctica, actividad, tarea

**Nombre normalizado**: la identidad de un hábito — minúsculas, sin espacios al
inicio/fin, espacios colapsados. Dos hábitos con el mismo nombre normalizado son
duplicados y el segundo no debe crearse.
_Avoid_: id, slug

**Etiqueta**: texto corto que describe qué significa cumplir (o no cumplir) el hábito
cada día, p. ej. "Este día sí hice ejercicio".
_Avoid_: descripción, frase

**Tipo**: clasificación de un hábito — bueno (a mantener) o malo (a evitar).
_Avoid_: categoría, signo positivo/negativo

**Cumplido**: un día marcado como hecho para un hábito (checkbox/check). Lo opuesto
es "no cumplido" (día pasado sin marcar) o "por marcar" (día futuro o de hoy sin marcar).
_Avoid_: done, completado, marcado

**Racha**: racha de días consecutivos cumplidos que termina hoy (o ayer) para un hábito.
_Avoid_: streak, racha actual

**Récord**: la racha consecutiva más larga que ese hábito ha alcanzado históricamente.
_Avoid_: mejor racha (reservado para el agregado global)

**Mejor racha**: el récord más alto entre todos los hábitos (métrica global de stats).

**Día perfecto**: un día en el que todos los hábitos de un tipo (bueno o malo) están
cumplido. Se cuenta por tipo, no por hábito.
_Avoid_: día completo, día ideal

**Respaldo**: archivo JSON descargable con el estado completo (hábitos + cumplidos),
incluye `version` y `exportedAt`; se puede importar de vuelta para restaurar o migrar.
_Avoid_: backup, export, copia de seguridad

**Localizar/importar**: lectura de un `Respaldo` desde un archivo elegido por el
usuario, validar su JSON y reemplazarlo en localStorage.

**Sesión demo**: experiencia temporal e independiente iniciada mediante el único
acceso público permitido. Cada visitante puede probar la app sin ver ni alterar los
datos de otras sesiones demo. Se liga al navegador que la crea y no se comparte ni
se recupera mediante enlaces, códigos o credenciales de usuario.
_Avoid_: usuario demo, cuenta demo, espacio compartido

**Reinicio de demo**: restauración de los datos iniciales dentro de la misma Sesión
demo, sin crear otra ni renovar su vigencia máxima.
_Avoid_: nueva sesión, borrar sesión

**Datos de Sesión demo**: nombres, Etiquetas y Cumplidos introducidos como datos de
prueba, sin promesa de confidencialidad y nunca destinados a datos reales. Aunque no
sean confidenciales, ninguna Sesión demo puede leer ni modificar los datos de otra.
_Avoid_: datos personales, datos privados
