/**
 * System Administration tasks for Specify 7.
 * These tasks leverage the Django ORM inside the web container to ensure 
 * business logic (like password hashing and table relationships) is respected.
 */
import { runPythonInWebContainer } from './executor.js';

export interface SpecifyUser {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  agentId: number | null;
  userType: string;
}

export async function listSpecifyUsers(): Promise<SpecifyUser[]> {
  const script = `
import json
from specifyweb.specify.models import Specifyuser

users = []
for su in Specifyuser.objects.all():
    users.append({
        'id': su.id,
        'username': su.name,
        'email': su.email,
        'firstName': '',
        'lastName': '',
        'agentId': None,
        'userType': su.usertype
    })

print("USERS_START")
print(json.dumps(users))
print("USERS_END")
`.trim();

  const { stdout } = await runPythonInWebContainer(script);
  const start = stdout.indexOf('USERS_START\n');
  const end = stdout.lastIndexOf('\nUSERS_END');
  if (start === -1 || end === -1) throw new Error('Failed to list users');
  
  return JSON.parse(stdout.slice(start + 12, end));
}

export async function createSpecifyUser(
  username: string, 
  password: string, 
  email: string, 
  firstName: string, 
  lastName: string, 
  collectionId: number
): Promise<string> {
  const script = `
import json
from django.contrib.auth import get_user_model
from specifyweb.specify.models import Specifyuser, Agent
from django.db import transaction

User = get_user_model()
username = ${JSON.stringify(username)}
password = ${JSON.stringify(password)}
email = ${JSON.stringify(email)}
first_name = ${JSON.stringify(firstName)}
last_name = ${JSON.stringify(lastName)}
collection_id = ${collectionId}

try:
    with transaction.atomic():
        # 1. Check if user already exists
        username_field = getattr(User, 'USERNAME_FIELD', 'username')
        if User.objects.filter(**{username_field: username}).exists():
            print(json.dumps({"error": f"User '{username}' already exists in Auth"}))
            exit()
            
        # 2. Create Django auth user (this is Specifyuser itself in unified mode)
        user_kwargs = {
            username_field: username,
            'email': email,
            'password': password
        }
        user = User.objects.create_user(**user_kwargs)
        user.first_name = first_name
        user.last_name = last_name
        
        # 3. Handle Unified vs Legacy logic for Specifyuser
        specify_user_id = None
        is_unified = (User == Specifyuser)
        
        if is_unified:
            if hasattr(user, 'usertype'):
                user.usertype = 'manager'
            if hasattr(user, 'isloggedin'):
                user.isloggedin = False
            if hasattr(user, 'isloggedinreport'):
                user.isloggedinreport = False
            user.save()
            specify_user_id = user.id
            su_ref = user
        else:
            user.save()
            su_data = {
                'name': username,
                'email': email,
                'usertype': 'manager',
                'isloggedin': False,
                'isloggedinreport': False
            }
            # Link to Django User if the field exists
            if 'user' in [f.name for f in Specifyuser._meta.get_fields()]:
                su_data['user'] = user
                
            su = Specifyuser.objects.create(**su_data)
            specify_user_id = su.id
            su_ref = su

        # 4. Create Agent and link to Specifyuser
        agent_data = {
            'agenttype': 1,
            'firstname': first_name,
            'lastname': last_name,
            'email': email
        }
        # Based on schema, Agent has 'specifyuser' field pointing to Specifyuser
        if 'specifyuser' in [f.name for f in Agent._meta.get_fields()]:
            agent_data['specifyuser'] = su_ref
            
        agent = Agent.objects.create(**agent_data)

        print(json.dumps({"success": True, "specifyUserId": specify_user_id, "agentId": agent.id}))
except Exception as e:
    import traceback
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
`.trim();

  const { stdout, stderr } = await runPythonInWebContainer(script);
  
  try {
    // Attempt to parse the last JSON object printed
    const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
    const result = JSON.parse(lines[lines.length - 1]);
    if (result.error) throw new Error(result.error);
    return `User created successfully. SpecifyUserID: ${result.specifyUserId}, AgentID: ${result.agentId}`;
  } catch (err: any) {
    throw new Error(`Failed to create user: ${err.message}. Output: ${stdout} ${stderr}`);
  }
}

export async function getSystemHealth(): Promise<string> {
  const script = `
import json
from django.db import connection
try:
    from celery import current_app
    celery_available = True
except ImportError:
    celery_available = False

health = {}

try:
    with connection.cursor() as cursor:
        cursor.execute("SELECT VERSION()")
        health['db_version'] = cursor.fetchone()[0]
        health['db_status'] = 'Connected'
except Exception as e:
    health['db_status'] = f'Error: {e}'

if celery_available:
    try:
        i = current_app.control.inspect()
        active = i.active()
        health['celery_workers'] = len(active) if active else 0
    except Exception as e:
        health['celery_workers'] = f'Error: {e}'
else:
    health['celery_workers'] = 'Celery module not found'

print(json.dumps(health, indent=2))
`.trim();

  const { stdout } = await runPythonInWebContainer(script);
  return stdout.trim();
}

export async function deleteSpecifyUser(username: string): Promise<string> {
  const script = `
import json
from django.contrib.auth import get_user_model
from specifyweb.specify.models import Specifyuser, Agent
from django.db import transaction
from django.db.models import ProtectedError

User = get_user_model()
username = ${JSON.stringify(username)}
username_field = getattr(User, 'USERNAME_FIELD', 'username')

try:
    with transaction.atomic():
        try:
            user = User.objects.get(**{username_field: username})
        except User.DoesNotExist:
            print(json.dumps({"error": f"User '{username}' not found"}))
            exit()
            
        is_unified = (User == Specifyuser)
        
        # In legacy mode, we need to find the Specifyuser as well
        su = None
        if not is_unified:
            try:
                su = Specifyuser.objects.get(name=username)
            except Specifyuser.DoesNotExist:
                pass
                
        # Agent might be linked to user or specifyuser
        agent = None
        try:
            agent = Agent.objects.get(specifyuser=user if is_unified else su)
        except (Agent.DoesNotExist, ValueError):
            pass

        # Try to delete the Agent if it exists. If it has historical records, this will fail.
        agent_deleted = False
        if agent:
            try:
                agent.delete()
                agent_deleted = True
            except ProtectedError:
                pass
            except Exception as e:
                # Some other DB integrity error
                if 'foreign key constraint' in str(e).lower() or 'integrityerror' in type(e).__name__.lower():
                    pass
                else:
                    raise e
                    
        # Now delete the user records
        if not is_unified and su:
            su.delete()
            
        user.delete()
        
        status_msg = f"User '{username}' successfully deleted."
        if agent and not agent_deleted:
            status_msg = f"User '{username}' login credentials and profile deleted. The Agent record was preserved because it has historical data linked to it."
            
        print(json.dumps({"success": True, "message": status_msg}))

except Exception as e:
    import traceback
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
`.trim();

  const { stdout, stderr } = await runPythonInWebContainer(script);
  
  try {
    const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
    if (lines.length === 0) throw new Error("No JSON output returned.");
    const result = JSON.parse(lines[lines.length - 1]);
    if (result.error) throw new Error(result.error);
    return result.message || "User deleted.";
  } catch (err: any) {
    throw new Error(`Failed to delete user: ${err.message}. Output: ${stdout} ${stderr}`);
  }
}
