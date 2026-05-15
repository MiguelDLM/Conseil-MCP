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
  collectionId: number,
  makeAdmin: boolean = false,
): Promise<string> {
  // In Specify 7, SpecifyUserManager.create_user() raises NotImplementedError.
  // The canonical pattern (taken from specifyweb.backend.setup_tool.api) is:
  //   1. Specifyuser.objects.create(name=..., password=<plaintext>, ...)
  //   2. user.set_password(user.password)   # Specify-specific encryption
  //   3. user.save()
  //   4. Agent.objects.create(agenttype=1, division=<from collection>, specifyuser=user, ...)
  //   5. Optionally UserPolicy.objects.create(resource='%', action='%') for admins.
  const script = `
import json
from specifyweb.specify.models import Specifyuser, Agent, Collection
from django.db import transaction

username = ${JSON.stringify(username)}
password = ${JSON.stringify(password)}
email = ${JSON.stringify(email)}
first_name = ${JSON.stringify(firstName)}
last_name = ${JSON.stringify(lastName)}
collection_id = ${collectionId}
make_admin = ${makeAdmin ? 'True' : 'False'}

try:
    with transaction.atomic():
        if Specifyuser.objects.filter(name=username).exists():
            print(json.dumps({"error": f"User '{username}' already exists."}))
            raise SystemExit(0)

        # 1. Create the Specifyuser row directly (manager.create_user is disabled).
        user_kwargs = {
            'name': username,
            'password': password,       # plaintext; set_password() re-encrypts below
            'usertype': 'Manager',
            'isloggedin': False,
            'isloggedinreport': False,
        }
        if email:
            user_kwargs['email'] = email
        new_user = Specifyuser.objects.create(**user_kwargs)

        # 2. Encrypt the password using Specify's custom scheme.
        new_user.set_password(new_user.password)
        new_user.save()

        # 3. Resolve the Division for the new Agent (Agent.division is NOT NULL).
        try:
            coll = Collection.objects.get(pk=collection_id)
            division = coll.discipline.division
        except Collection.DoesNotExist:
            print(json.dumps({"error": f"Collection #{collection_id} not found."}))
            raise SystemExit(0)

        # 4. Create the Agent and link it back to the new user.
        agent_kwargs = {
            'agenttype': 1,  # Person
            'lastname': last_name or username,
            'specifyuser': new_user,
            'division': division,
        }
        if first_name:
            agent_kwargs['firstname'] = first_name
        if email:
            agent_kwargs['email'] = email
        agent = Agent.objects.create(**agent_kwargs)

        # 5. Optional admin grant — only if explicitly requested.
        if make_admin:
            try:
                from specifyweb.permissions.models import UserPolicy
                UserPolicy.objects.create(
                    specifyuser=new_user,
                    collection=None,
                    resource='%',
                    action='%'
                )
            except Exception as e:
                # Permissions module may not be exposed in every Specify build;
                # surface the user creation success but warn.
                print(json.dumps({
                    "success": True,
                    "specifyUserId": new_user.id,
                    "agentId": agent.id,
                    "adminGrantWarning": f"User created but admin grant failed: {e}"
                }))
                raise SystemExit(0)

        print(json.dumps({"success": True, "specifyUserId": new_user.id, "agentId": agent.id}))
except SystemExit:
    raise
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
  // Specify enforces a business rule
  // (specifyweb.backend.businessrules.rules.agent_rules.agent_delete_blocked_by_related_specifyuser)
  // that prevents deleting an Agent while it still references a Specifyuser.
  // Correct order: detach Agent.specifyuser → delete Specifyuser → optionally
  // delete Agent (skip if Agent has historical FKs from determinations,
  // collectionobjects, etc.).
  const script = `
import json
from specifyweb.specify.models import Specifyuser, Agent
from django.db import transaction
from django.db.models import ProtectedError

username = ${JSON.stringify(username)}

try:
    with transaction.atomic():
        try:
            user = Specifyuser.objects.get(name=username)
        except Specifyuser.DoesNotExist:
            print(json.dumps({"error": f"User '{username}' not found"}))
            raise SystemExit(0)

        # Collect agents that reference this user.
        agents = list(Agent.objects.filter(specifyuser=user))

        # Detach every agent so the user can be deleted cleanly.
        for ag in agents:
            ag.specifyuser = None
            ag.save()

        # Delete the user (cascades into UserPolicy, SpAppResourceDir, etc.).
        user.delete()

        # Try to delete each (now-detached) agent. Will fail with ProtectedError
        # if the agent has historical references (determinations, cataloger,
        # etc.) — in that case we keep the agent record for data integrity.
        kept_agents = []
        deleted_agents = []
        for ag in agents:
            try:
                ag.delete()
                deleted_agents.append(ag.id)
            except (ProtectedError, Exception) as e:
                kept_agents.append({"agentId": ag.id, "reason": str(e)[:120]})

        msg = f"User '{username}' deleted."
        if deleted_agents:
            msg += f" Agents removed: {deleted_agents}."
        if kept_agents:
            msg += f" Agents preserved (historical FKs): {[a['agentId'] for a in kept_agents]}."

        print(json.dumps({"success": True, "message": msg, "deletedAgents": deleted_agents, "keptAgents": kept_agents}))

except SystemExit:
    raise
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
