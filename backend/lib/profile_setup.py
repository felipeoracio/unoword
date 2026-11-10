"""Guided answers augment the existing profile; never replace legacy free text."""
import json

def question(id, title, title_es, choices, multiple=True):
    return {'id': id, 'title': title, 'title_es': title_es, 'multiple': multiple,
            'options': [{'id': key, 'label': label, 'label_es': es} for key, label, es in choices]}

QUESTIONS = [
 question('types','What type of writing do you enjoy?','¿Qué tipo de escritura disfrutas?',[
  ('fiction','Fiction','Ficción'),('nonfiction','Nonfiction','No ficción'),('memoir','Memoir','Memorias'),('poetry','Poetry','Poesía'),('blogging','Blogging','Blogs'),('essays','Essays','Ensayos'),('journaling','Journaling','Diario personal'),('academic','Academic Writing','Escritura académica'),('business','Business Writing','Escritura profesional')]),
 question('goals','What are your main writing goals?','¿Cuáles son tus principales objetivos al escribir?',[
  ('habit','Build a daily writing habit','Crear un hábito diario'),('book','Finish a book','Terminar un libro'),('skills','Improve my writing skills','Mejorar mi escritura'),('block','Overcome writer’s block','Superar el bloqueo creativo'),('publish','Publish my writing','Publicar mis textos'),('express','Express my thoughts','Expresar mis pensamientos'),('experiences','Document personal experiences','Documentar experiencias personales'),('audience','Grow an audience','Ampliar mi audiencia')]),
 question('style','How would you describe your writing style?','¿Cómo describirías tu estilo?',[
  ('conversational','Conversational','Conversacional'),('reflective','Reflective','Reflexivo'),('descriptive','Descriptive','Descriptivo'),('informative','Informative','Informativo'),('persuasive','Persuasive','Persuasivo'),('creative','Creative','Creativo'),('humorous','Humorous','Humorístico'),('emotional','Emotional','Emotivo'),('concise','Direct and concise','Directo y conciso')]),
 question('challenges','What challenges do you face when writing?','¿Qué dificultades encuentras al escribir?',[
  ('starting','Getting started','Empezar'),('consistency','Staying consistent','Mantener la constancia'),('ideas','Finding ideas','Encontrar ideas'),('organization','Organizing my thoughts','Organizar mis ideas'),('block','Writer’s block','Bloqueo creativo'),('time','Finding enough time','Encontrar tiempo'),('finishing','Finishing projects','Terminar proyectos'),('focus','Staying focused','Mantener la concentración'),('confidence','Self-doubt','Dudas sobre mí mismo')]),
 question('motivations','What motivates you to write?','¿Qué te motiva a escribir?',[
  ('growth','Personal growth','Crecimiento personal'),('sharing','Sharing my experiences','Compartir mis experiencias'),('helping','Helping others','Ayudar a otros'),('creativity','Creativity','Creatividad'),('career','Building a career','Desarrollar una carrera'),('memories','Preserving memories','Conservar recuerdos'),('emotions','Expressing emotions','Expresar emociones'),('learning','Learning','Aprender')]),
 question('audience','Who is your intended audience?','¿Para quién escribes?',[
  ('general','General readers','Lectores en general'),('children','Children','Niños'),('young_adults','Young adults','Jóvenes'),('professionals','Professionals','Profesionales'),('students','Students','Estudiantes'),('family','Friends and family','Familiares y amigos'),('community','A specific community','Una comunidad específica'),('myself','Myself','Para mí')]),
 question('assistance','What kind of AI assistance would help you most?','¿Qué ayuda de IA te resultaría más útil?',[
  ('prompts','Writing prompts','Ideas para escribir'),('questions','Brainstorming questions','Preguntas creativas'),('outlines','Organization and outlines','Organización y esquemas'),('feedback','Writing feedback','Comentarios sobre mis textos'),('research','Research guidance','Orientación de investigación'),('motivation','Accountability and motivation','Constancia y motivación'),('block','Help overcoming writer’s block','Ayuda con el bloqueo creativo'),('improvement','Identifying areas for improvement','Identificar aspectos a mejorar')]),
 question('experience','How would you describe your writing experience?','¿Cuál es tu experiencia escribiendo?',[
  ('starting','Just getting started','Acabo de empezar'),('beginner','Beginner','Principiante'),('intermediate','Intermediate','Intermedio'),('experienced','Experienced','Experimentado'),('professional','Professional writer','Escritor profesional')],False),
 question('tone','What tone do you prefer in writing guidance?','¿Qué tono prefieres en la orientación?',[
  ('supportive','Encouraging and supportive','Alentador y comprensivo'),('practical','Direct and practical','Directo y práctico'),('reflective','Thoughtful and reflective','Reflexivo y atento'),('analytical','Detailed and analytical','Detallado y analítico'),('inspiring','Creative and inspiring','Creativo e inspirador')],False),
 question('frequency','How often would you like to write?','¿Con qué frecuencia quieres escribir?',[
  ('daily','Every day','Todos los días'),('several','Several times a week','Varias veces por semana'),('weekly','Once a week','Una vez por semana'),('inspiration','Whenever inspiration strikes','Cuando llegue la inspiración'),('flexible','Flexible / No fixed schedule','Flexible / Sin horario fijo')],False),
]
BY_ID = {q['id']: q for q in QUESTIONS}

def parse_answer(row):
    try:
        value = json.loads(row.get('answer') or '{}')
        if isinstance(value, dict) and value.get('version') == 1: return value
    except (ValueError, TypeError): pass
    return {'selected_option_ids': [], 'custom_answer': '', 'notes': '', 'revision': 0,
            'legacy_answer': row.get('answer') or ''}

def guided_profile(answers):
    result = {}
    for row in answers:
        key = row.get('question_id', '').removeprefix('setup:')
        question = BY_ID.get(key)
        if not question or not row.get('question_id', '').startswith('setup:'): continue
        answer = parse_answer(row)
        labels = {option['id']: option['label'] for option in question['options']}
        chosen = [labels[id] for id in answer.get('selected_option_ids', []) if id in labels]
        chosen += [str(answer.get(key) or '')[:2000] for key in ('custom_answer','notes','legacy_answer') if answer.get(key)]
        if chosen: result[question['title']] = chosen
    return result
