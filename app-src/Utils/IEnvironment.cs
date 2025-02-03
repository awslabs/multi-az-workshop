namespace BAMCIS.MultiAZApp.Utils
{
    public interface IEnvironment
    {
        bool Probe();

        Environment GetEnvironmentType();

        string GetInstanceId();

        string GetHostId();

        string GetRegion();

        string GetAZId();

        string GetAZ();
    }
}